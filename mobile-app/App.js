import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import {
  AppState,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useAudioPlayer, setAudioModeAsync } from 'expo-audio'
import Constants from 'expo-constants'
import * as Haptics from 'expo-haptics'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import { io } from 'socket.io-client'
import nearTurnSound from './assets/near-turn.wav'
import calledSound from './assets/called.wav'
import {
  QUEUE_ENTRY_QR_PAYLOAD,
  parseQueueEntryQr,
} from './queue-entry-qr.mjs'
import { apiRequest, getApiOrigin } from './api.mjs'
import {
  claimAlertOnce,
  getTicketView,
  hasReachedNearTurn,
  isCalledTransition,
  parseTicketAlertEvent,
  triggerAlertOnce,
} from './queue-alerts.mjs'
import {
  createInitialQueueFlow,
  getTerminalTicketPresentation,
  queueFlowReducer,
  shouldMonitorTicket,
  stopQueueMonitoring,
} from './queue-flow.mjs'

const activeTicketStorageKey = 'queuemate.active-ticket'
const notificationChannels = [
  {
    id: 'queuemate-near-turn-v1',
    name: 'QueueMate - Turn approaching',
    sound: 'near-turn.wav',
    vibrationPattern: [0, 320, 140, 320],
  },
  {
    id: 'queuemate-called-v1',
    name: 'QueueMate - Ticket called',
    sound: 'called.wav',
    vibrationPattern: [0, 500, 140, 500, 140, 700],
  },
]

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  })
}

const colors = {
  blue: '#173CCB',
  yellow: '#FFD52A',
  white: '#FFFFFF',
  paleBlue: '#F3F6FF',
  textMuted: '#52628D',
  border: '#DCE4F5',
}

export default function App() {
  const [permission, requestPermission] = useCameraPermissions()
  const [flow, dispatchFlow] = useReducer(
    queueFlowReducer,
    undefined,
    createInitialQueueFlow,
  )
  const [scanning, setScanning] = useState(false)
  const [manualEntry, setManualEntry] = useState(false)
  const [manualCode, setManualCode] = useState('')
  const [notificationMessage, setNotificationMessage] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const scanHandled = useRef(false)
  const issueRequestInFlight = useRef(false)
  const ticketFlowGeneration = useRef(0)
  const activeTicketId = useRef(null)
  const lastTicketStatus = useRef(new Map())
  const alertedEvents = useRef(new Set())
  const expoPushToken = useRef(null)
  const pushTokenRequest = useRef(null)
  const ticketStorageQueue = useRef(Promise.resolve())
  const restoringTicketIds = useRef(new Set())
  const nearTurnPlayer = useAudioPlayer(nearTurnSound)
  const calledPlayer = useAudioPlayer(calledSound)
  const ticket = flow.ticket
  const queue = flow.queue
  const ticketView = getTicketView(ticket?.status)
  const terminalTicket = getTerminalTicketPresentation(ticket)
  const nearTurnAlert = hasReachedNearTurn(ticket)

  useEffect(() => {
    void setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'duckOthers',
    }).catch((error) => {
      console.warn('QueueMate alert audio is unavailable.', error)
    })
  }, [])

  const getExpoPushToken = useCallback(async () => {
    if (Platform.OS === 'web') return null
    if (expoPushToken.current) return expoPushToken.current

    if (!pushTokenRequest.current) {
      pushTokenRequest.current = (async () => {
        if (Platform.OS === 'android') {
          await Promise.all(notificationChannels.map((channel) => (
            Notifications.setNotificationChannelAsync(channel.id, {
              name: channel.name,
              importance: Notifications.AndroidImportance.MAX,
              sound: channel.sound,
              vibrationPattern: channel.vibrationPattern,
              enableVibrate: true,
              showBadge: true,
            })
          )))
        }

        const current = await Notifications.getPermissionsAsync()
        const permission = current.granted
          ? current
          : await Notifications.requestPermissionsAsync()
        if (!permission.granted) {
          setNotificationMessage(
            'Push notifications are disabled. Keep QueueMate open to receive queue alerts.',
          )
          return null
        }

        const projectId = Constants.expoConfig?.extra?.eas?.projectId
          ?? Constants.easConfig?.projectId
        if (!projectId) {
          throw new Error(
            'Expo project ID is missing. Configure EXPO_PUBLIC_EAS_PROJECT_ID to enable background alerts.',
          )
        }

        const tokenResult = await Notifications.getExpoPushTokenAsync({ projectId })
        expoPushToken.current = tokenResult.data
        return tokenResult.data
      })()
    }

    try {
      return await pushTokenRequest.current
    } finally {
      pushTokenRequest.current = null
    }
  }, [])

  const persistActiveTicket = useCallback((ticket) => {
    const operation = ticketStorageQueue.current
      .catch((error) => {
        console.warn('A previous QueueMate ticket could not be stored.', error)
      })
      .then(() => SecureStore.setItemAsync(
        activeTicketStorageKey,
        JSON.stringify({
          ticketId: ticket.ticketId,
          ticketAccessToken: ticket.ticketAccessToken,
        }),
      ))
    ticketStorageQueue.current = operation
    return operation
  }, [])

  const clearStoredTicket = useCallback((ticketId) => {
    const operation = ticketStorageQueue.current
      .catch((error) => {
        console.warn('A previous QueueMate ticket could not be stored.', error)
      })
      .then(async () => {
        const storedTicket = await SecureStore.getItemAsync(activeTicketStorageKey)
        if (!storedTicket) return
        let parsedTicket
        try {
          parsedTicket = JSON.parse(storedTicket)
        } catch {
          await SecureStore.deleteItemAsync(activeTicketStorageKey)
          throw new Error('Stored ticket credentials were invalid and removed.')
        }
        if (parsedTicket.ticketId === ticketId) {
          await SecureStore.deleteItemAsync(activeTicketStorageKey)
        }
      })
    ticketStorageQueue.current = operation
    return operation
  }, [])

  const registerPushTokenForTicket = useCallback(async (ticketToRegister) => {
    try {
      const token = await getExpoPushToken()
      if (!token || activeTicketId.current !== ticketToRegister.ticketId) return
      await apiRequest(`/public/tickets/${ticketToRegister.ticketId}/push-token`, {
        method: 'POST',
        ticketToken: ticketToRegister.ticketAccessToken,
        body: { expoPushToken: token },
      })
      if (activeTicketId.current === ticketToRegister.ticketId) {
        setNotificationMessage('')
      }
    } catch (error) {
      console.warn('QueueMate background push registration failed.', error)
      if (activeTicketId.current === ticketToRegister.ticketId) {
        setNotificationMessage(
          'Background notifications could not be enabled. Keep QueueMate open to receive queue alerts.',
        )
      }
    }
  }, [getExpoPushToken])

  const triggerTicketAlert = useCallback((ticketId, eventType) => {
    return triggerAlertOnce(
      alertedEvents.current,
      ticketId,
      eventType,
      {
        playSound() {
          const player = eventType === 'called' ? calledPlayer : nearTurnPlayer
          player.pause()
          void player.seekTo(0)
            .then(() => {
              if (activeTicketId.current === ticketId) player.play()
            })
            .catch((error) => {
              console.warn('QueueMate alert sound could not be played.', error)
            })
        },
        vibrate() {
          if (Platform.OS === 'android') {
            const channel = notificationChannels.find((item) => (
              item.id === (
                eventType === 'called'
                  ? 'queuemate-called-v1'
                  : 'queuemate-near-turn-v1'
              )
            ))
            try {
              Vibration.vibrate(channel.vibrationPattern)
            } catch (error) {
              console.warn('QueueMate vibration alert is unavailable.', error)
            }
            return
          }

          const hapticType = eventType === 'called'
            ? Haptics.NotificationFeedbackType.Success
            : Haptics.NotificationFeedbackType.Warning
          void Haptics.notificationAsync(hapticType).catch((error) => {
            console.warn('QueueMate haptic alert is unavailable.', error)
          })
        },
      },
    )
  }, [calledPlayer, nearTurnPlayer])

  const restoreTicketFromNotification = useCallback(async (ticketId) => {
    if (activeTicketId.current && activeTicketId.current !== ticketId) return
    if (Platform.OS === 'web') return
    if (restoringTicketIds.current.has(ticketId)) return

    const restoreGeneration = ticketFlowGeneration.current
    restoringTicketIds.current.add(ticketId)
    try {
      await ticketStorageQueue.current
      if (restoreGeneration !== ticketFlowGeneration.current) return
      const storedTicket = await SecureStore.getItemAsync(activeTicketStorageKey)
      if (!storedTicket) return

      let credentials
      try {
        credentials = JSON.parse(storedTicket)
      } catch {
        await SecureStore.deleteItemAsync(activeTicketStorageKey)
        throw new Error('Stored ticket credentials are invalid.')
      }

      if (
        credentials.ticketId !== ticketId
        || typeof credentials.ticketAccessToken !== 'string'
        || !credentials.ticketAccessToken
      ) {
        return
      }

      const ticketStatus = await apiRequest(`/public/tickets/${ticketId}`, {
        ticketToken: credentials.ticketAccessToken,
      })
      if (
        restoreGeneration !== ticketFlowGeneration.current
        || (activeTicketId.current && activeTicketId.current !== ticketId)
      ) {
        return
      }

      const restoredTicket = {
        ...ticketStatus,
        ticketId,
        ticketAccessToken: credentials.ticketAccessToken,
      }
      activeTicketId.current = ticketId
      lastTicketStatus.current.clear()
      lastTicketStatus.current.set(ticketId, restoredTicket.status)
      dispatchFlow({ type: 'ticket-restored', ticket: restoredTicket })
      setRefreshKey((key) => key + 1)
      void registerPushTokenForTicket(restoredTicket)
    } finally {
      restoringTicketIds.current.delete(ticketId)
    }
  }, [registerPushTokenForTicket])

  const handleNotificationResponse = useCallback((response) => {
    const alertEvent = parseTicketAlertEvent(
      response.notification.request.content.data,
    )
    if (!alertEvent) return
    const { ticketId, eventType } = alertEvent

    claimAlertOnce(alertedEvents.current, ticketId, eventType)
    if (activeTicketId.current === ticketId) {
      dispatchFlow({ type: 'open-ticket' })
      setRefreshKey((key) => key + 1)
      return
    }
    if (activeTicketId.current) return

    void restoreTicketFromNotification(ticketId).catch((error) => {
      console.warn('QueueMate could not restore the ticket from this alert.', error)
      setNotificationMessage(
        'This queue alert could not be opened. Scan the TV QR code to start again.',
      )
    })
  }, [restoreTicketFromNotification])

  useEffect(() => {
    if (Platform.OS === 'web') return undefined

    const receivedSubscription = Notifications.addNotificationReceivedListener(
      (notification) => {
        const alertEvent = parseTicketAlertEvent(
          notification.request.content.data,
        )
        if (!alertEvent || activeTicketId.current !== alertEvent.ticketId) {
          return
        }

        triggerTicketAlert(alertEvent.ticketId, alertEvent.eventType)
        setRefreshKey((key) => key + 1)
      },
    )
    const responseSubscription = Notifications.addNotificationResponseReceivedListener(
      handleNotificationResponse,
    )
    const lastResponse = Notifications.getLastNotificationResponse()
    if (lastResponse) handleNotificationResponse(lastResponse)

    return () => {
      receivedSubscription.remove()
      responseSubscription.remove()
    }
  }, [handleNotificationResponse, triggerTicketAlert])

  useEffect(() => {
    if (!nearTurnAlert || !ticket?.ticketId) return
    triggerTicketAlert(ticket.ticketId, 'near-turn')
  }, [
    nearTurnAlert,
    ticket?.ticketId,
    ticket?.queuePosition,
    triggerTicketAlert,
  ])

  useEffect(() => {
    if (!shouldMonitorTicket(ticket, flow.screen)) return undefined

    let active = true
    let requestInFlight = false
    let refreshRequested = false

    async function refreshLiveData() {
      if (!active || activeTicketId.current !== ticket.ticketId) return
      if (requestInFlight) {
        refreshRequested = true
        return
      }
      requestInFlight = true

      do {
        refreshRequested = false
        const [ticketResult, queueResult] = await Promise.allSettled([
          apiRequest(`/public/tickets/${ticket.ticketId}`, {
            ticketToken: ticket.ticketAccessToken,
          }),
          apiRequest('/public/queue'),
        ])

        if (!active || activeTicketId.current !== ticket.ticketId) break

        if (ticketResult.status === 'fulfilled') {
          const updatedTicket = ticketResult.value
          const previousStatus = lastTicketStatus.current.get(ticket.ticketId)
            ?? ticket.status
          if (isCalledTransition(previousStatus, updatedTicket.status)) {
            triggerTicketAlert(ticket.ticketId, 'called')
          }
          lastTicketStatus.current.set(ticket.ticketId, updatedTicket.status)
          dispatchFlow({
            type: 'ticket-updated',
            ticketId: ticket.ticketId,
            ticket: updatedTicket,
          })
        } else {
          dispatchFlow({
            type: 'tracking-error',
            ticketId: ticket.ticketId,
            source: 'ticket',
            message: ticketResult.reason instanceof Error
              ? ticketResult.reason.message
              : 'Unable to refresh your ticket status.',
          })
        }

        if (queueResult.status === 'fulfilled') {
          dispatchFlow({
            type: 'queue-updated',
            ticketId: ticket.ticketId,
            queue: queueResult.value,
          })
        } else {
          dispatchFlow({
            type: 'tracking-error',
            ticketId: ticket.ticketId,
            source: 'queue',
            message: queueResult.reason instanceof Error
              ? queueResult.reason.message
              : 'Unable to refresh the public queue.',
          })
        }
      } while (active && refreshRequested)
      requestInFlight = false
    }

    void refreshLiveData()
    const interval = setInterval(() => {
      void refreshLiveData()
    }, 10000)

    const appStateSubscription = AppState.addEventListener('change', async (state) => {
      if (state !== 'active') return
      if (Platform.OS !== 'web') {
        try {
          const presentedNotifications = await Notifications.getPresentedNotificationsAsync()
          for (const notification of presentedNotifications) {
            const alertEvent = parseTicketAlertEvent(
              notification.request.content.data,
            )
            if (alertEvent?.ticketId === ticket.ticketId) {
              claimAlertOnce(
                alertedEvents.current,
                alertEvent.ticketId,
                alertEvent.eventType,
              )
            }
          }
        } catch (error) {
          console.warn('QueueMate could not check pending notifications.', error)
        }
      }
      if (active) void refreshLiveData()
    })

    let socket
    try {
      socket = io(getApiOrigin())
      socket.on('connect', refreshLiveData)
      const handleTicketEvent = (event) => {
        if (
          event?.ticketNumber === ticket.ticketNumber
          && event?.businessDate === ticket.businessDate
        ) {
          void refreshLiveData()
        }
      }
      for (const eventName of [
        'ticket:called',
        'ticket:completed',
        'ticket:skipped',
      ]) {
        socket.on(eventName, handleTicketEvent)
      }
      socket.on('notification:created', (event) => {
        if (
          event?.alertType === 'near_turn'
          && event?.ticketNumber === ticket.ticketNumber
        ) {
          void refreshLiveData()
        }
      })
      socket.on('window:updated', refreshLiveData)
    } catch (error) {
      console.warn('QueueMate live socket is unavailable; HTTP polling will continue.', error)
    }

    return () => {
      active = false
      stopQueueMonitoring({ interval, appStateSubscription, socket })
    }
  }, [
    ticket?.ticketId,
    ticket?.ticketAccessToken,
    ticket?.status,
    ticket,
    flow.screen,
    refreshKey,
    triggerTicketAlert,
  ])

  function acceptQueueEntryQr(value) {
    if (!parseQueueEntryQr(value)) return false

    ticketFlowGeneration.current += 1
    dispatchFlow({ type: 'qr-accepted' })
    setManualEntry(false)
    setScanning(false)
    return true
  }

  async function startScanning() {
    dispatchFlow({ type: 'message', message: '' })
    scanHandled.current = false

    if (permission?.granted) {
      setScanning(true)
      return
    }

    try {
      const result = await requestPermission()
      if (result.granted) {
        setScanning(true)
      } else {
        dispatchFlow({
          type: 'message',
          message: result.canAskAgain
            ? 'Camera permission is needed to scan. You can allow access or enter the code manually.'
            : 'Camera access is turned off for QueueMate. Enable it in your phone settings or enter the code manually.',
        })
      }
    } catch {
      dispatchFlow({
        type: 'message',
        message: 'Camera access is unavailable right now. Please enter the flow identifier manually.',
      })
    }
  }

  function handleBarcodeScanned({ data }) {
    if (scanHandled.current) return
    scanHandled.current = true

    if (!acceptQueueEntryQr(data)) {
      setScanning(false)
      dispatchFlow({
        type: 'message',
        message: 'Invalid QR code. Scan the official QueueMate queue-entry code shown on the Public TV Display.',
      })
    }
  }

  function submitManualCode() {
    if (!manualCode.trim()) {
      dispatchFlow({
        type: 'message',
        message: 'Enter the official flow identifier shown beside the TV QR code.',
      })
      return
    }

    if (!acceptQueueEntryQr(manualCode)) {
      dispatchFlow({
        type: 'message',
        message: 'Invalid flow identifier. Check the official code shown on the Public TV Display.',
      })
    }
  }

  function closeScanner() {
    setScanning(false)
    scanHandled.current = false
  }

  async function createTicket() {
    if (!flow.selectedTransaction || issueRequestInFlight.current) return

    ticketFlowGeneration.current += 1
    const requestGeneration = ticketFlowGeneration.current
    issueRequestInFlight.current = true
    setNotificationMessage('')
    dispatchFlow({ type: 'issue-started' })
    try {
      const issuedTicket = await apiRequest('/public/tickets', {
        method: 'POST',
        body: { transactionType: flow.selectedTransaction },
      })
      if (requestGeneration !== ticketFlowGeneration.current) return
      if (
        !issuedTicket?.ticketId
        || !issuedTicket.ticketAccessToken
        || !issuedTicket.ticketNumber
        || !issuedTicket.transactionType
        || !issuedTicket.status
      ) {
        throw new Error('The backend did not return a valid queue ticket.')
      }

      activeTicketId.current = issuedTicket.ticketId
      lastTicketStatus.current.clear()
      lastTicketStatus.current.set(issuedTicket.ticketId, issuedTicket.status)
      alertedEvents.current.clear()
      dispatchFlow({ type: 'ticket-issued', ticket: issuedTicket })
      if (Platform.OS !== 'web') {
        try {
          await persistActiveTicket(issuedTicket)
        } catch (error) {
          console.warn('QueueMate could not securely store the active ticket.', error)
          if (activeTicketId.current === issuedTicket.ticketId) {
            setNotificationMessage(
              'The ticket cannot be restored by tapping an alert. Keep QueueMate open to monitor it.',
            )
          }
        }
        void registerPushTokenForTicket(issuedTicket)
      }
    } catch (error) {
      if (requestGeneration !== ticketFlowGeneration.current) return
      dispatchFlow({
        type: 'issue-failed',
        message: error instanceof Error
          ? error.message
          : 'Unable to issue a ticket. Please try again.',
      })
    } finally {
      issueRequestInFlight.current = false
    }
  }

  function finishTicket() {
    ticketFlowGeneration.current += 1
    const oldTicketId = activeTicketId.current
    activeTicketId.current = null
    issueRequestInFlight.current = false
    lastTicketStatus.current.clear()
    alertedEvents.current.clear()
    setNotificationMessage('')
    nearTurnPlayer.pause()
    calledPlayer.pause()
    if (Platform.OS !== 'web') Vibration.cancel()
    if (oldTicketId && Platform.OS !== 'web') {
      void clearStoredTicket(oldTicketId).catch((error) => {
        console.warn('QueueMate stored ticket could not be cleared.', error)
      })
    }
    if (Platform.OS !== 'web') {
      void Notifications.dismissAllNotificationsAsync().catch((error) => {
        console.warn('QueueMate notifications could not be dismissed.', error)
      })
    }
    setScanning(false)
    setManualEntry(false)
    setManualCode('')
    scanHandled.current = false
    dispatchFlow({ type: 'done' })
  }
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={colors.blue} />
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.brandMark}>
            <Text style={styles.brandMarkText}>Q</Text>
          </View>
          <Text style={styles.brandName}>
            Queue<Text style={styles.brandAccent}>Mate</Text>
          </Text>
        </View>

        {ticket && terminalTicket ? (
          <View style={styles.content}>
            <View
              style={
                terminalTicket.status === 'completed'
                  ? styles.successIcon
                  : styles.skippedIcon
              }
            >
              <Text
                style={
                  terminalTicket.status === 'completed'
                    ? styles.successIconText
                    : styles.skippedIconText
                }
              >
                {terminalTicket.status === 'completed' ? '✓' : '!'}
              </Text>
            </View>
            <View style={styles.intro}>
              <Text style={styles.eyebrow}>
                {terminalTicket.status === 'completed' ? 'QUEUE COMPLETE' : 'QUEUE UPDATE'}
              </Text>
              <Text style={styles.title}>{terminalTicket.title}</Text>
              <Text style={styles.description}>{terminalTicket.description}</Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={finishTicket}
              style={[styles.button, styles.primaryButton, styles.doneButton]}
            >
              <Text style={styles.primaryButtonText}>{terminalTicket.actionLabel}</Text>
            </TouchableOpacity>
          </View>
        ) : ticket && ticketView === 'expired' ? (
          <View style={styles.content}>
            <View style={styles.skippedIcon}>
              <Text style={styles.skippedIconText}>!</Text>
            </View>
            <View style={styles.intro}>
              <Text style={styles.eyebrow}>QUEUE UPDATE</Text>
              <Text style={styles.title}>This ticket has expired.</Text>
              <Text style={styles.description}>
                Ticket {ticket.ticketNumber} is no longer active. Please start a new queue entry.
              </Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={finishTicket}
              style={[styles.button, styles.primaryButton, styles.doneButton]}
            >
              <Text style={styles.primaryButtonText}>DONE</Text>
            </TouchableOpacity>
          </View>
        ) : ticket && ticketView === 'called' ? (
          <View style={styles.content}>
            <View style={styles.calledIcon}>
              <Text style={styles.calledIconText}>!</Text>
            </View>
            <View style={styles.intro}>
              <Text style={styles.eyebrow}>NOW SERVING</Text>
              <Text style={styles.title}>Your number is being called!</Text>
              <Text style={styles.description}>
                Ticket {ticket.ticketNumber}
              </Text>
            </View>
            <View style={styles.calledWindowCard}>
              <Text style={styles.calledWindowLabel}>PROCEED TO</Text>
              <Text style={styles.calledWindowNumber}>
                WINDOW {ticket.windowNumber ?? '—'}
              </Text>
            </View>
            <Text style={styles.successNote}>
              Please proceed to your assigned cashier window now.
            </Text>
            {flow.ticketError ? (
              <Text accessibilityRole="alert" style={styles.message}>
                Unable to confirm the latest ticket status: {flow.ticketError}
              </Text>
            ) : null}
            {notificationMessage ? (
              <Text style={styles.permissionNotice}>{notificationMessage}</Text>
            ) : null}
          </View>
        ) : flow.screen === 'monitoring' ? (
          <ScrollView
            contentContainerStyle={styles.monitorContent}
            style={styles.monitorScroll}
          >
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => dispatchFlow({ type: 'open-ticket' })}
              style={styles.backButton}
            >
              <Text style={styles.backButtonText}>‹  Back to Ticket</Text>
            </TouchableOpacity>
            <View style={styles.intro}>
              <Text style={styles.eyebrow}>QUEUE MONITORING</Text>
              <Text style={styles.title}>Your queue</Text>
              <Text style={styles.description}>
                Live ticket status and serving numbers refresh automatically.
              </Text>
            </View>
            {nearTurnAlert ? (
              <View accessibilityRole="alert" style={styles.nearTurnAlert}>
                <Text style={styles.nearTurnAlertTitle}>Your turn is approaching!</Text>
                <Text style={styles.nearTurnAlertText}>
                  You are {ticket.queuePosition} in the live waiting queue.
                </Text>
              </View>
            ) : null}
            {ticket ? (
              <View style={styles.monitorTicketCard}>
                <View style={styles.monitorTicketNumberWrap}>
                  <Text style={styles.monitorTicketLabel}>YOUR NUMBER</Text>
                  <Text style={styles.monitorTicketNumber}>{ticket.ticketNumber}</Text>
                </View>
                <View style={styles.monitorTicketDetails}>
                  <Text style={styles.monitorTransaction}>
                    {ticket.transactionType}
                  </Text>
                  <Text style={styles.monitorStatus}>{ticket.status?.toUpperCase()}</Text>
                </View>
              </View>
            ) : null}
            {ticket?.windowNumber ? (
              <Text style={styles.assignmentNotice}>
                Please proceed to Window {ticket.windowNumber} when called.
              </Text>
            ) : null}
            {flow.ticketError ? (
              <Text accessibilityRole="alert" style={styles.message}>
                Ticket status could not be refreshed: {flow.ticketError}
              </Text>
            ) : null}
            {ticket?.queuePosition ? (
              <Text style={styles.assignmentNotice}>
                Live waiting position: {ticket.queuePosition}
              </Text>
            ) : null}
            <View style={styles.windowSectionHeading}>
              <Text style={styles.windowSectionTitle}>Cashier Windows</Text>
            </View>
            {flow.queueError ? (
              <Text accessibilityRole="alert" style={styles.message}>
                Live queue could not be refreshed: {flow.queueError}
              </Text>
            ) : null}
            {queue ? (
              <View style={styles.windowList}>
                {queue.windows.map((window) => (
                  <View key={window.windowNumber} style={styles.windowCard}>
                    <View style={styles.windowNumberBadge}>
                      <Text style={styles.windowNumberBadgeText}>{window.windowNumber}</Text>
                    </View>
                    <View style={styles.windowInfo}>
                      <Text style={styles.windowName}>Window {window.windowNumber}</Text>
                      <Text style={styles.windowServing}>
                        {window.currentTicketNumber
                          ? `Serving #${window.currentTicketNumber}`
                          : 'No ticket being served'}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.windowStatusBadge,
                        window.status === 'available' && styles.windowAvailableBadge,
                      ]}
                    >
                      <Text
                        style={[
                          styles.windowStatusText,
                          window.status === 'available' && styles.windowAvailableText,
                        ]}
                      >
                        {window.currentTicketNumber
                          ? 'SERVING'
                          : window.status.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : !flow.queueError ? (
              <Text style={styles.windowServing}>Loading live queue...</Text>
            ) : null}
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => setRefreshKey((key) => key + 1)}
              style={[styles.button, styles.primaryButton, styles.refreshButton]}
            >
              <Text style={styles.primaryButtonText}>Refresh Queue</Text>
            </TouchableOpacity>
          </ScrollView>
        ) : flow.screen === 'ticket' && ticket ? (
          <View style={styles.content}>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => dispatchFlow({ type: 'open-monitoring' })}
              style={styles.backButton}
            >
              <Text style={styles.backButtonText}>‹  Monitor Queue</Text>
            </TouchableOpacity>
            <View style={styles.intro}>
              <Text style={styles.eyebrow}>QUEUE TICKET</Text>
              <Text style={styles.title}>Your queue ticket</Text>
              <Text style={styles.description}>
                This ticket was issued by the QueueMate queue system.
              </Text>
            </View>
            <View style={styles.ticketCard}>
              <Text style={styles.ticketNumberLabel}>QUEUE NUMBER</Text>
              <Text style={styles.ticketNumber}>{ticket.ticketNumber}</Text>
              <View style={styles.ticketDivider} />
              <Text style={styles.ticketDetailLabel}>TRANSACTION</Text>
              <Text style={styles.ticketDetail}>
                {ticket.transactionType}
              </Text>
              <View style={styles.ticketStatus}>
                <View style={styles.ticketStatusDot} />
                <Text style={styles.ticketStatusText}>{ticket.status?.toUpperCase()}</Text>
              </View>
            </View>
            {nearTurnAlert ? (
              <View accessibilityRole="alert" style={styles.nearTurnAlert}>
                <Text style={styles.nearTurnAlertTitle}>Your turn is approaching!</Text>
                <Text style={styles.nearTurnAlertText}>
                  You are {ticket.queuePosition} in the live waiting queue.
                </Text>
              </View>
            ) : null}
            {ticket?.queuePosition ? (
              <Text style={styles.assignmentNotice}>
                Live waiting position: {ticket.queuePosition}
              </Text>
            ) : null}
            {flow.ticketError ? (
              <Text accessibilityRole="alert" style={styles.message}>
                Ticket status could not be refreshed: {flow.ticketError}
              </Text>
            ) : null}
            {notificationMessage ? (
              <Text style={styles.permissionNotice}>{notificationMessage}</Text>
            ) : null}
            <Text style={styles.successNote}>
              Please monitor the queue while you wait for your number to be called.
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => dispatchFlow({ type: 'open-monitoring' })}
              style={[styles.button, styles.primaryButton, styles.continueButton]}
            >
              <Text style={styles.primaryButtonText}>Monitor Queue</Text>
            </TouchableOpacity>
          </View>
        ) : flow.screen === 'selection' ? (
          <View style={styles.content}>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => dispatchFlow({ type: 'open-verified' })}
              style={styles.backButton}
            >
              <Text style={styles.backButtonText}>‹  Back</Text>
            </TouchableOpacity>
            <View style={styles.intro}>
              <Text style={styles.eyebrow}>QUEUE ENTRY VERIFIED</Text>
              <Text style={styles.title}>Select Your Transaction</Text>
              <Text style={styles.description}>
                Choose the service you need today.
              </Text>
            </View>
            <View style={styles.transactionOptions}>
              {[
                { id: 'SOA', title: 'Statement of Account (SOA)' },
                { id: 'Payment', title: 'Payment' },
                { id: 'Other Transactions', title: 'Other' },
              ].map((transaction) => {
                const isSelected = flow.selectedTransaction === transaction.id

                return (
                  <TouchableOpacity
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected }}
                    key={transaction.id}
                    onPress={() => {
                      dispatchFlow({
                        type: 'select-transaction',
                        transaction: transaction.id,
                      })
                    }}
                    style={[
                      styles.transactionOption,
                      isSelected && styles.transactionOptionSelected,
                    ]}
                  >
                    <View
                      style={[
                        styles.selectionIndicator,
                        isSelected && styles.selectionIndicatorSelected,
                      ]}
                    >
                      {isSelected ? <View style={styles.selectionDot} /> : null}
                    </View>
                    <Text
                      style={[
                        styles.transactionOptionText,
                        isSelected && styles.transactionOptionTextSelected,
                      ]}
                    >
                      {transaction.title}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityState={{
                disabled: !flow.selectedTransaction || flow.isIssuingTicket,
              }}
              disabled={!flow.selectedTransaction || flow.isIssuingTicket}
              onPress={createTicket}
              style={[
                styles.button,
                styles.primaryButton,
                styles.continueButton,
                (!flow.selectedTransaction || flow.isIssuingTicket) && styles.disabledButton,
              ]}
            >
              <Text style={styles.primaryButtonText}>
                {flow.isIssuingTicket ? 'Issuing Ticket...' : 'Continue'}
              </Text>
            </TouchableOpacity>
            {flow.message ? <Text style={styles.message}>{flow.message}</Text> : null}
          </View>
        ) : flow.screen === 'verified' ? (
          <View style={styles.content}>
            <View style={styles.successIcon}>
              <Text style={styles.successIconText}>✓</Text>
            </View>
            <View style={styles.intro}>
              <Text style={styles.eyebrow}>QUEUE ENTRY VERIFIED</Text>
              <Text style={styles.title}>Queue entry ready</Text>
              <Text style={styles.description}>
                The QueueMate queue-entry QR was verified. Select a service to request a live ticket.
              </Text>
            </View>
            <View style={styles.confirmedCodeCard}>
              <Text style={styles.confirmedCodeLabel}>QUEUE ENTRY</Text>
              <Text style={styles.confirmedCode}>{flow.confirmedCode}</Text>
            </View>
            <Text style={styles.successNote}>
              Choose a transaction to continue.
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => dispatchFlow({ type: 'open-selection' })}
              style={[styles.button, styles.primaryButton, styles.continueButton]}
            >
              <Text style={styles.primaryButtonText}>
                {flow.isIssuingTicket ? 'Issuing Ticket...' : 'Continue'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => {
                dispatchFlow({ type: 'return-to-welcome' })
                setManualCode('')
              }}
              style={styles.secondaryAction}
            >
              <Text style={styles.secondaryActionText}>Back to Welcome</Text>
            </TouchableOpacity>
          </View>
        ) : scanning ? (
          <View style={styles.scanScreen}>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={closeScanner}
              style={styles.backButton}
            >
              <Text style={styles.backButtonText}>‹  Back</Text>
            </TouchableOpacity>
            <Text style={styles.scanTitle}>Scan QR Code</Text>
            <Text style={styles.scanDescription}>
              Point your camera at the QR code on the Public TV Display.
            </Text>
            <View style={styles.cameraFrame}>
              <CameraView
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                facing="back"
                onBarcodeScanned={handleBarcodeScanned}
                style={styles.camera}
              />
              <View pointerEvents="none" style={styles.scanOverlay}>
                <View style={styles.scanCorners} />
                <Text style={styles.scanHint}>Align the QR code inside the frame</Text>
              </View>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => {
                closeScanner()
                setManualEntry(true)
              }}
              style={styles.manualLink}
            >
              <Text style={styles.manualLinkText}>Enter flow identifier manually</Text>
            </TouchableOpacity>
          </View>
        ) : manualEntry ? (
          <View style={styles.content}>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => {
                setManualEntry(false)
                dispatchFlow({ type: 'message', message: '' })
              }}
              style={styles.backButton}
            >
              <Text style={styles.backButtonText}>‹  Back</Text>
            </TouchableOpacity>
            <View style={styles.intro}>
              <Text style={styles.eyebrow}>ALTERNATIVE ACCESS</Text>
              <Text style={styles.title}>Enter QueueMate flow identifier</Text>
              <Text style={styles.description}>
                Enter the official flow identifier shown beside the Public TV QR code.
              </Text>
            </View>
            <TextInput
              accessibilityLabel="Queue-entry flow identifier"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={(value) => {
                setManualCode(value)
                dispatchFlow({ type: 'message', message: '' })
              }}
              onSubmitEditing={submitManualCode}
              maxLength={QUEUE_ENTRY_QR_PAYLOAD.length}
              placeholder={QUEUE_ENTRY_QR_PAYLOAD}
              placeholderTextColor="#8290B5"
              returnKeyType="done"
              style={styles.input}
              value={manualCode}
            />
            <TouchableOpacity
              accessibilityRole="button"
              onPress={submitManualCode}
              style={[styles.button, styles.primaryButton, styles.continueButton]}
            >
              <Text style={styles.primaryButtonText}>Continue</Text>
            </TouchableOpacity>
            {flow.message ? <Text style={styles.message}>{flow.message}</Text> : null}
          </View>
        ) : (
          <View style={styles.content}>
            <View style={styles.welcomeIcon}>
              <Text style={styles.welcomeIconText}>⌗</Text>
            </View>
            <View style={styles.intro}>
              <Text style={styles.eyebrow}>STUDENT &amp; PARENT APP</Text>
              <Text style={styles.title}>Welcome to QueueMate</Text>
              <Text style={styles.description}>
                Scan the official QR code displayed on the Public TV Display to begin queue entry.
              </Text>
            </View>

            <TouchableOpacity
              accessibilityRole="button"
              onPress={startScanning}
              style={[styles.button, styles.primaryButton]}
            >
              <Text style={styles.buttonIcon}>▦</Text>
              <Text style={styles.primaryButtonText}>Scan QR Code</Text>
            </TouchableOpacity>

            <View style={styles.separator}>
              <View style={styles.separatorLine} />
              <Text style={styles.separatorText}>OR</Text>
              <View style={styles.separatorLine} />
            </View>

            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => {
                dispatchFlow({ type: 'message', message: '' })
                setManualEntry(true)
              }}
              style={[styles.button, styles.secondaryButton]}
            >
              <Text style={styles.secondaryButtonText}>Enter Flow Identifier</Text>
            </TouchableOpacity>

            {flow.message ? <Text style={styles.message}>{flow.message}</Text> : null}
            <Text style={styles.privacyNote}>
              Your camera is only requested when you choose to scan.
            </Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.blue,
  },
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  header: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    backgroundColor: colors.blue,
  },
  brandMark: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: colors.yellow,
  },
  brandMarkText: {
    color: colors.blue,
    fontSize: 21,
    fontWeight: '900',
  },
  brandName: {
    marginLeft: 10,
    color: colors.white,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  brandAccent: {
    color: colors.yellow,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 38,
  },
  monitorScroll: {
    flex: 1,
  },
  monitorContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
  },
  monitorTicketCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 14,
    backgroundColor: colors.blue,
  },
  nearTurnAlert: {
    marginBottom: 14,
    padding: 16,
    borderWidth: 2,
    borderColor: colors.yellow,
    borderRadius: 13,
    backgroundColor: '#FFF8D6',
  },
  nearTurnAlertTitle: {
    color: colors.blue,
    fontSize: 16,
    fontWeight: '900',
  },
  nearTurnAlertText: {
    marginTop: 6,
    color: colors.blue,
    fontSize: 13,
    lineHeight: 19,
  },
  assignmentNotice: {
    marginTop: 11,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#FFF8D6',
    color: colors.blue,
    fontSize: 12,
    lineHeight: 18,
  },
  monitorTicketNumberWrap: {
    minWidth: 92,
    alignItems: 'center',
    paddingRight: 15,
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.35)',
  },
  monitorTicketLabel: {
    color: colors.yellow,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  monitorTicketNumber: {
    marginTop: 2,
    color: colors.white,
    fontSize: 35,
    fontWeight: '900',
    lineHeight: 40,
  },
  monitorTicketDetails: {
    flex: 1,
    paddingLeft: 15,
  },
  monitorTransaction: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '700',
  },
  monitorStatus: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: colors.yellow,
    color: colors.blue,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  windowSectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 25,
    marginBottom: 11,
  },
  windowSectionTitle: {
    color: colors.blue,
    fontSize: 18,
    fontWeight: '900',
  },
  windowList: {
    gap: 10,
  },
  windowCard: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.white,
  },
  windowNumberBadge: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 11,
    borderRadius: 11,
    backgroundColor: colors.yellow,
  },
  windowNumberBadgeText: {
    color: colors.blue,
    fontSize: 16,
    fontWeight: '900',
  },
  windowInfo: {
    flex: 1,
  },
  windowName: {
    color: colors.blue,
    fontSize: 14,
    fontWeight: '800',
  },
  windowServing: {
    marginTop: 3,
    color: colors.textMuted,
    fontSize: 12,
  },
  windowStatusBadge: {
    marginLeft: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: colors.blue,
  },
  windowAvailableBadge: {
    backgroundColor: '#E8F7EF',
  },
  windowStatusText: {
    color: colors.white,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  windowAvailableText: {
    color: '#187A45',
  },
  refreshButton: {
    marginTop: 15,
  },
  welcomeIcon: {
    width: 70,
    height: 70,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    backgroundColor: '#FFF4C2',
  },
  welcomeIconText: {
    color: colors.blue,
    fontSize: 39,
    fontWeight: '700',
  },
  successIcon: {
    width: 70,
    height: 70,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 35,
    backgroundColor: colors.yellow,
  },
  successIconText: {
    color: colors.blue,
    fontSize: 38,
    fontWeight: '800',
  },
  calledIcon: {
    width: 70,
    height: 70,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 35,
    backgroundColor: colors.yellow,
  },
  calledIconText: {
    color: colors.blue,
    fontSize: 38,
    fontWeight: '900',
  },
  skippedIcon: {
    width: 70,
    height: 70,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 35,
    backgroundColor: '#FFE5E5',
  },
  skippedIconText: {
    color: '#A12626',
    fontSize: 38,
    fontWeight: '900',
  },
  calledWindowCard: {
    alignItems: 'center',
    paddingVertical: 18,
    borderRadius: 14,
    backgroundColor: colors.blue,
  },
  calledWindowLabel: {
    color: colors.yellow,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },
  calledWindowNumber: {
    marginTop: 6,
    color: colors.white,
    fontSize: 27,
    fontWeight: '900',
  },
  doneButton: {
    marginTop: 26,
  },
  permissionNotice: {
    marginTop: 12,
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  confirmedCodeCard: {
    alignItems: 'center',
    paddingVertical: 18,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.paleBlue,
  },
  confirmedCodeLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  confirmedCode: {
    marginTop: 6,
    color: colors.blue,
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 1,
  },
  ticketCard: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 22,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.paleBlue,
  },
  ticketNumberLabel: {
    marginTop: 19,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  ticketNumber: {
    marginTop: 2,
    color: colors.blue,
    fontSize: 66,
    fontWeight: '900',
    letterSpacing: 2,
    lineHeight: 78,
  },
  ticketDivider: {
    width: '100%',
    height: 1,
    marginVertical: 16,
    backgroundColor: colors.border,
  },
  ticketDetailLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  ticketDetail: {
    marginTop: 6,
    color: colors.blue,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  ticketStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 17,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: colors.white,
  },
  ticketStatusDot: {
    width: 8,
    height: 8,
    marginRight: 7,
    borderRadius: 4,
    backgroundColor: '#1A9A57',
  },
  ticketStatusText: {
    color: colors.blue,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  successNote: {
    marginTop: 18,
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  secondaryAction: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionText: {
    color: colors.blue,
    fontSize: 14,
    fontWeight: '700',
  },
  transactionOptions: {
    gap: 14,
  },
  transactionOption: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 13,
    backgroundColor: colors.white,
  },
  transactionOptionSelected: {
    borderColor: colors.blue,
    backgroundColor: '#EEF2FF',
  },
  selectionIndicator: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 12,
  },
  selectionIndicatorSelected: {
    borderColor: colors.blue,
    backgroundColor: colors.yellow,
  },
  selectionDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.blue,
  },
  transactionOptionText: {
    flex: 1,
    color: colors.blue,
    fontSize: 16,
    fontWeight: '700',
  },
  transactionOptionTextSelected: {
    fontWeight: '900',
  },
  disabledButton: {
    opacity: 0.45,
  },
  intro: {
    marginTop: 27,
    marginBottom: 29,
  },
  eyebrow: {
    color: colors.blue,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  title: {
    marginTop: 9,
    color: colors.blue,
    fontSize: 29,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  description: {
    marginTop: 11,
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 23,
  },
  button: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  primaryButton: {
    backgroundColor: colors.blue,
  },
  buttonIcon: {
    marginRight: 10,
    color: colors.yellow,
    fontSize: 21,
  },
  primaryButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '800',
  },
  separator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 22,
  },
  separatorLine: {
    height: 1,
    flex: 1,
    backgroundColor: colors.border,
  },
  separatorText: {
    marginHorizontal: 13,
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
  },
  secondaryButton: {
    borderWidth: 1.5,
    borderColor: colors.blue,
    backgroundColor: colors.white,
  },
  secondaryButtonText: {
    color: colors.blue,
    fontSize: 15,
    fontWeight: '800',
  },
  privacyNote: {
    marginTop: 23,
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  message: {
    marginTop: 16,
    padding: 13,
    borderRadius: 10,
    backgroundColor: '#FFF4C2',
    color: colors.blue,
    fontSize: 13,
    lineHeight: 19,
  },
  scanScreen: {
    flex: 1,
    paddingHorizontal: 22,
    paddingTop: 12,
  },
  backButton: {
    alignSelf: 'flex-start',
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  backButtonText: {
    color: colors.blue,
    fontSize: 15,
    fontWeight: '700',
  },
  scanTitle: {
    marginTop: 14,
    color: colors.blue,
    fontSize: 26,
    fontWeight: '800',
  },
  scanDescription: {
    marginTop: 8,
    marginBottom: 22,
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
  },
  cameraFrame: {
    minHeight: 300,
    flex: 1,
    overflow: 'hidden',
    borderRadius: 18,
    backgroundColor: colors.blue,
  },
  camera: {
    flex: 1,
  },
  scanOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanCorners: {
    width: 226,
    height: 226,
    borderWidth: 3,
    borderColor: colors.yellow,
    borderRadius: 20,
  },
  scanHint: {
    position: 'absolute',
    bottom: 17,
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.blue,
    color: colors.white,
    fontSize: 12,
  },
  manualLink: {
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualLinkText: {
    color: colors.blue,
    fontSize: 14,
    fontWeight: '800',
  },
  input: {
    height: 56,
    paddingHorizontal: 15,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 11,
    backgroundColor: colors.white,
    color: colors.blue,
    fontSize: 16,
  },
  continueButton: {
    marginTop: 14,
  },
})
