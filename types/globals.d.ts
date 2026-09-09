export {}

declare global {
  interface CustomJwtSessionClaims {
    metadata?: {
      modules?: string[]
    }
  }
}
