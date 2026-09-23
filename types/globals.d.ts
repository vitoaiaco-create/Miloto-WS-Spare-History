export {}

declare global {
  interface CustomJwtSessionClaims {
    metadata: {
      role?: string
      modules?: (
        | "spares_history"
        | "workshop_analytics"
        | "oils_servicing"
        | "logistics_analytics"
      )[]
    }
  }
}
