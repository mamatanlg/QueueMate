import { useEffect, useRef, useState } from 'react'
import {
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

const VALID_ACCESS_CODE = 'QM-47K2'
const DEMO_WINDOWS = [
  { id: 1, servingNumber: '252', status: 'SERVING' },
  { id: 2, servingNumber: '248', status: 'SERVING' },
  { id: 3, servingNumber: '250', status: 'SERVING' },
  { id: 4, servingNumber: null, status: 'AVAILABLE' },
]

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
  const [scanning, setScanning] = useState(false)
  const [manualEntry, setManualEntry] = useState(false)
  const [manualCode, setManualCode] = useState('')
  const [message, setMessage] = useState('')
  const [accessGranted, setAccessGranted] = useState(false)
  const [confirmedCode, setConfirmedCode] = useState('')
  const [selectedTransaction, setSelectedTransaction] = useState('')
  const [transactionSelection, setTransactionSelection] = useState(false)
  const [demoTicket, setDemoTicket] = useState(null)
  const [ticketScreen, setTicketScreen] = useState(false)
  const [monitoringScreen, setMonitoringScreen] = useState(false)
  const [demoWindows, setDemoWindows] = useState(DEMO_WINDOWS)
  const [queueRefreshed, setQueueRefreshed] = useState(false)
  const [nearTurnAlertEvent, setNearTurnAlertEvent] = useState(null)
  const scanHandled = useRef(false)
  const ticketCreated = useRef(false)
  const alertedNearTurnEvent = useRef(null)

  const transactionNames = {
    soa: 'Statement of Account (SOA)',
    payment: 'Payment',
  }
  const assignedWindow = demoTicket?.assignedWindowId
    ? demoWindows.find((window) => window.id === demoTicket.assignedWindowId)
    : null
  const ticketNumber = Number(demoTicket?.number)
  const servingNumber = Number(assignedWindow?.servingNumber)
  const isExactlyFiveAhead =
    assignedWindow &&
    assignedWindow.status === 'SERVING' &&
    Number.isFinite(ticketNumber) &&
    Number.isFinite(servingNumber) &&
    ticketNumber - servingNumber === 5

  useEffect(() => {
    if (!isExactlyFiveAhead || !assignedWindow) {
      setNearTurnAlertEvent(null)
      return
    }

    const eventKey = `${demoTicket.number}:${assignedWindow.id}`
    setNearTurnAlertEvent({
      ticketNumber: demoTicket.number,
      windowId: assignedWindow.id,
    })

    if (alertedNearTurnEvent.current !== eventKey) {
      alertedNearTurnEvent.current = eventKey
      Vibration.vibrate([0, 400, 200, 400])
    }
  }, [assignedWindow, demoTicket, isExactlyFiveAhead])

  function normalizeAccessCode(value) {
    const trimmedValue = typeof value === 'string' ? value.trim() : ''
    if (!trimmedValue) return ''

    if (/^QM-[A-Z0-9]{4}$/i.test(trimmedValue)) {
      return trimmedValue.toUpperCase()
    }

    try {
      const url = new URL(trimmedValue)
      const urlContent = decodeURIComponent(`${url.pathname}${url.search}${url.hash}`)
      const match = urlContent.match(
        /(?:^|[^A-Z0-9])(QM-[A-Z0-9]{4})(?=$|[^A-Z0-9])/i,
      )
      return match ? match[1].toUpperCase() : trimmedValue.toUpperCase()
    } catch {
      return trimmedValue.toUpperCase()
    }
  }

  function acceptAccessCode(value) {
    const normalizedCode = normalizeAccessCode(value)
    if (normalizedCode !== VALID_ACCESS_CODE) return false

    setConfirmedCode(VALID_ACCESS_CODE)
    setAccessGranted(true)
    setManualEntry(false)
    setScanning(false)
    setMessage('')
    return true
  }

  async function startScanning() {
    setMessage('')
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
        setMessage(
          result.canAskAgain
            ? 'Camera permission is needed to scan. You can allow access or enter the code manually.'
            : 'Camera access is turned off for QueueMate. Enable it in your phone settings or enter the code manually.',
        )
      }
    } catch {
      setMessage('Camera access is unavailable right now. Please enter the access code manually.')
    }
  }

  function handleBarcodeScanned({ data }) {
    if (scanHandled.current) return
    scanHandled.current = true

    if (!acceptAccessCode(data)) {
      setScanning(false)
      setMessage('Invalid QR code. Scan the QueueMate code shown on the Public TV Display.')
    }
  }

  function submitManualCode() {
    if (!manualCode.trim()) {
      setMessage('Enter the access code shown beside the QR code on the display.')
      return
    }

    if (!acceptAccessCode(manualCode)) {
      setMessage('Invalid access code. Check the code on the Public TV Display and try again.')
    }
  }

  function closeScanner() {
    setScanning(false)
    setMessage('')
    scanHandled.current = false
  }

  function createDemoTicket() {
    if (!selectedTransaction) return

    if (!ticketCreated.current) {
      ticketCreated.current = true
      setDemoTicket({
        number: '048',
        transaction: selectedTransaction,
        status: 'WAITING',
        assignedWindowId: null,
      })
    }

    setTransactionSelection(false)
    setTicketScreen(true)
    setMessage('')
  }

  function refreshDemoQueue() {
    setDemoWindows(DEMO_WINDOWS.map((window) => ({ ...window })))
    setQueueRefreshed(true)
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

        {monitoringScreen ? (
          <ScrollView
            contentContainerStyle={styles.monitorContent}
            style={styles.monitorScroll}
          >
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => setMonitoringScreen(false)}
              style={styles.backButton}
            >
              <Text style={styles.backButtonText}>‹  Back to Ticket</Text>
            </TouchableOpacity>
            <View style={styles.intro}>
              <Text style={styles.eyebrow}>QUEUE MONITORING</Text>
              <Text style={styles.title}>Your queue</Text>
              <Text style={styles.description}>
                Check your demo ticket and the sample serving numbers below.
              </Text>
            </View>
            {nearTurnAlertEvent ? (
              <View accessibilityRole="alert" style={styles.nearTurnAlert}>
                <Text style={styles.nearTurnAlertTitle}>Your turn is approaching!</Text>
                <Text style={styles.nearTurnAlertText}>
                  Please return to the Business Office. You are five numbers from
                  being called at Window {nearTurnAlertEvent.windowId}.
                </Text>
                <Text style={styles.nearTurnDemoLabel}>DEMO ALERT</Text>
              </View>
            ) : null}
            {demoTicket ? (
              <View style={styles.monitorTicketCard}>
                <View style={styles.monitorTicketNumberWrap}>
                  <Text style={styles.monitorTicketLabel}>YOUR NUMBER</Text>
                  <Text style={styles.monitorTicketNumber}>{demoTicket.number}</Text>
                </View>
                <View style={styles.monitorTicketDetails}>
                  <Text style={styles.monitorTransaction}>
                    {transactionNames[demoTicket.transaction]}
                  </Text>
                  <Text style={styles.monitorStatus}>{demoTicket.status}</Text>
                </View>
              </View>
            ) : null}
            {demoTicket && !assignedWindow ? (
              <Text style={styles.assignmentNotice}>
                Near-turn alert is demo-only. This ticket has no assigned window,
                so it cannot be compared to an unrelated serving number.
              </Text>
            ) : null}
            <View style={styles.windowSectionHeading}>
              <Text style={styles.windowSectionTitle}>Cashier Windows</Text>
              <Text style={styles.demoBadge}>DEMO DATA</Text>
            </View>
            <View style={styles.windowList}>
              {demoWindows.map((window) => (
                <View key={window.id} style={styles.windowCard}>
                  <View style={styles.windowNumberBadge}>
                    <Text style={styles.windowNumberBadgeText}>{window.id}</Text>
                  </View>
                  <View style={styles.windowInfo}>
                    <Text style={styles.windowName}>Window {window.id}</Text>
                    <Text style={styles.windowServing}>
                      {window.servingNumber
                        ? `Serving #${window.servingNumber}`
                        : 'No ticket being served'}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.windowStatusBadge,
                      window.status === 'AVAILABLE' && styles.windowAvailableBadge,
                    ]}
                  >
                    <Text
                      style={[
                        styles.windowStatusText,
                        window.status === 'AVAILABLE' && styles.windowAvailableText,
                      ]}
                    >
                      {window.status}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
            <Text style={styles.demoDisclaimer}>
              These queue numbers are sample data for demonstration only. They are
              not live and are not connected to the school queue system.
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={refreshDemoQueue}
              style={[styles.button, styles.primaryButton, styles.refreshButton]}
            >
              <Text style={styles.primaryButtonText}>Refresh Demo Queue</Text>
            </TouchableOpacity>
            {queueRefreshed ? (
              <Text style={styles.refreshFeedback}>Demo queue data reloaded.</Text>
            ) : null}
          </ScrollView>
        ) : ticketScreen && demoTicket ? (
          <View style={styles.content}>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => {
                setSelectedTransaction(demoTicket.transaction)
                setTicketScreen(false)
                setTransactionSelection(true)
              }}
              style={styles.backButton}
            >
              <Text style={styles.backButtonText}>‹  Back</Text>
            </TouchableOpacity>
            <View style={styles.intro}>
              <Text style={styles.eyebrow}>QUEUE TICKET</Text>
              <Text style={styles.title}>Your demo ticket</Text>
              <Text style={styles.description}>
                This is a local demonstration ticket, not an actual queue issuance.
              </Text>
            </View>
            <View style={styles.ticketCard}>
              <Text style={styles.demoBadge}>DEMO</Text>
              <Text style={styles.ticketNumberLabel}>QUEUE NUMBER</Text>
              <Text style={styles.ticketNumber}>{demoTicket.number}</Text>
              <View style={styles.ticketDivider} />
              <Text style={styles.ticketDetailLabel}>TRANSACTION</Text>
              <Text style={styles.ticketDetail}>
                {transactionNames[demoTicket.transaction]}
              </Text>
              <View style={styles.ticketStatus}>
                <View style={styles.ticketStatusDot} />
                <Text style={styles.ticketStatusText}>{demoTicket.status}</Text>
              </View>
            </View>
            <Text style={styles.successNote}>
              Please monitor the queue while you wait for your number to be called.
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => setMonitoringScreen(true)}
              style={[styles.button, styles.primaryButton, styles.continueButton]}
            >
              <Text style={styles.primaryButtonText}>Monitor Queue</Text>
            </TouchableOpacity>
          </View>
        ) : transactionSelection ? (
          <View style={styles.content}>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => {
                setTransactionSelection(false)
                setMessage('')
              }}
              style={styles.backButton}
            >
              <Text style={styles.backButtonText}>‹  Back</Text>
            </TouchableOpacity>
            <View style={styles.intro}>
              <Text style={styles.eyebrow}>ACCESS CODE: {confirmedCode}</Text>
              <Text style={styles.title}>Select Your Transaction</Text>
              <Text style={styles.description}>
                Choose the service you need today.
              </Text>
            </View>
            <View style={styles.transactionOptions}>
              {[
                { id: 'soa', title: 'Statement of Account (SOA)' },
                { id: 'payment', title: 'Payment' },
              ].map((transaction) => {
                const isSelected = selectedTransaction === transaction.id

                return (
                  <TouchableOpacity
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected }}
                    key={transaction.id}
                    onPress={() => {
                      setSelectedTransaction(transaction.id)
                      setMessage('')
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
              accessibilityState={{ disabled: !selectedTransaction }}
              disabled={!selectedTransaction}
              onPress={createDemoTicket}
              style={[
                styles.button,
                styles.primaryButton,
                styles.continueButton,
                !selectedTransaction && styles.disabledButton,
              ]}
            >
              <Text style={styles.primaryButtonText}>Continue</Text>
            </TouchableOpacity>
            {message ? <Text style={styles.message}>{message}</Text> : null}
          </View>
        ) : accessGranted ? (
          <View style={styles.content}>
            <View style={styles.successIcon}>
              <Text style={styles.successIconText}>✓</Text>
            </View>
            <View style={styles.intro}>
              <Text style={styles.eyebrow}>ACCESS CONFIRMED</Text>
              <Text style={styles.title}>You're connected</Text>
              <Text style={styles.description}>
                The QueueMate access code was verified successfully.
              </Text>
            </View>
            <View style={styles.confirmedCodeCard}>
              <Text style={styles.confirmedCodeLabel}>ACCESS CODE</Text>
              <Text style={styles.confirmedCode}>{confirmedCode}</Text>
            </View>
            <Text style={styles.successNote}>
              Choose a transaction to continue.
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => setTransactionSelection(true)}
              style={[styles.button, styles.primaryButton, styles.continueButton]}
            >
              <Text style={styles.primaryButtonText}>Continue</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => {
                setAccessGranted(false)
                setConfirmedCode('')
                setSelectedTransaction('')
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
              <Text style={styles.manualLinkText}>Enter access code manually</Text>
            </TouchableOpacity>
          </View>
        ) : manualEntry ? (
          <View style={styles.content}>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => {
                setManualEntry(false)
                setMessage('')
              }}
              style={styles.backButton}
            >
              <Text style={styles.backButtonText}>‹  Back</Text>
            </TouchableOpacity>
            <View style={styles.intro}>
              <Text style={styles.eyebrow}>ALTERNATIVE ACCESS</Text>
              <Text style={styles.title}>Enter access code</Text>
              <Text style={styles.description}>
                Find the short code beside the QR code on the Public TV Display.
              </Text>
            </View>
            <TextInput
              accessibilityLabel="Access code"
              autoCapitalize="characters"
              autoCorrect={false}
              onChangeText={(value) => {
                setManualCode(value)
                setMessage('')
              }}
              onSubmitEditing={submitManualCode}
              placeholder="Enter access code"
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
            {message ? <Text style={styles.message}>{message}</Text> : null}
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
                Scan the QR code displayed on the Public TV Display to get a queue number.
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
                setMessage('')
                setManualEntry(true)
              }}
              style={[styles.button, styles.secondaryButton]}
            >
              <Text style={styles.secondaryButtonText}>Manual Access Code</Text>
            </TouchableOpacity>

            {message ? <Text style={styles.message}>{message}</Text> : null}
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
  nearTurnDemoLabel: {
    alignSelf: 'flex-start',
    marginTop: 9,
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
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
  demoDisclaimer: {
    marginTop: 16,
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  refreshButton: {
    marginTop: 15,
  },
  refreshFeedback: {
    marginTop: 9,
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
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
  demoBadge: {
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: colors.yellow,
    color: colors.blue,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
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
