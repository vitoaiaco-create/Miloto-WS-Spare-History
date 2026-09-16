export {}

declare global {
  interface CustomJwtSessionClaims {
    metadata: {
      role?: string
      modules?: string[]
    }
  }
}
