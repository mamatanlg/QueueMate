export default ({ config }) => {
  const projectId = globalThis.process?.env?.EXPO_PUBLIC_EAS_PROJECT_ID
  const extra = config.extra ?? {}

  return {
    ...config,
    extra: projectId
      ? {
        ...extra,
        eas: {
          ...extra.eas,
          projectId,
        },
      }
      : extra,
  }
}
