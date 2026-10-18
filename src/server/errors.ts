/** Error with an HTTP status, turned into a JSON response by the route wrapper. */
export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}
