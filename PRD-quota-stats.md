# PRD: Quota Information and Model Statistics Fetching

## 1. Overview
Implement a robust mechanism to fetch, track, and display Gemini API quota information and model statistics within the `pi.dev` codebase. This will provide users with visibility into their remaining usage limits and help manage expectations regarding model availability and performance.

## 2. Technical Research Findings (from Gemini CLI)

### 2.1 API Endpoints
- **Base Endpoint:** `https://cloudcode-pa.googleapis.com/v1internal`
- **Quota Retrieval:** `:retrieveUserQuota` (POST)
- **User Settings/Status:** `:loadCodeAssist` (POST)
- **Metrics Recording:** `:recordCodeAssistMetrics` (POST)

### 2.2 Data Structures

#### Quota Response (`RetrieveUserQuotaResponse`)
```typescript
export interface RetrieveUserQuotaResponse {
  buckets?: BucketInfo[];
}

export interface BucketInfo {
  remainingAmount?: string;   // Absolute remaining tokens/requests
  remainingFraction?: number; // Fraction (0.0 to 1.0)
  resetTime?: string;         // ISO timestamp of quota reset
  tokenType?: string;         // e.g., "CHAT"
  modelId?: string;           // The specific model ID (e.g., "gemini-2.0-pro-exp-02-05")
}
```

#### User Tier & Credits
```typescript
export interface AvailableCredits {
  creditType: string;         // e.g., "GOOGLE_ONE_AI"
  creditAmount: string;       // int64 string
}
```

### 2.3 Authentication
- **Personal OAuth:** Uses `google-auth-library` to obtain tokens.
- **Service Accounts/ADC:** Supported via `compute-default-credentials`.
- **Headers:** Requires `Authorization: Bearer <token>` and standardized `User-Agent`.

## 3. Proposed Implementation in `pi-mono`

### 3.1 Service Layer
Create a `QuotaService` in `packages/ai/src/services/quotaService.ts`:
- **Initialization:** Inject OAuth credentials.
- **Fetching:** Implement `fetchQuota()` using the `retrieveUserQuota` endpoint.
- **Caching:** Cache results with a short TTL (e.g., 1 minute) or trigger refresh after each LLM interaction.
- **Calculations:** 
  - If `remainingAmount` is present, derive `limit = remainingAmount / remainingFraction`.
  - If only `remainingFraction` is present, use a normalized scale (0-100%).

### 3.2 State Management
- Use a centralized state (e.g., in `AgentLoopContext` or a dedicated Store) to hold the latest `buckets`.
- Emit events when quota changes to trigger UI updates.

### 3.3 UI Components
Implement a `QuotaDisplay` component:
- **Visuals:** Use progress bars for each model's bucket, clearly labeled as **Remaining** capacity.
- **Colors:** Transition from Green (>50%) to Yellow (20-50%) to Red (<20%).
- **Tooltips:** Show absolute remaining values and reset times on hover.

### 3.4 Integration with AI Provider
- Automatically call `refreshQuota()` after a successful `generateContent` call finishes (use `usageMetadata` for immediate local decrement if desired, but verify with server).
- Handle `429 Too Many Requests` by triggering a mandatory quota refresh and suggesting fallback models.

## 4. Implementation Steps
1. **Infrastructure:** Add `google-auth-library` to `packages/ai/package.json`.
2. **Core Logic:** Implement `CodeAssistClient` to wrap the internal API endpoints.
3. **Integration:** Hook `QuotaService` into the `AgentLoop`.
4. **UI:** Create the React components for quota visualization in the TUI/Web UI.
5. **Testing:** Add unit tests for quota calculation and integration tests for API mocks.
6. **Example Extension:** Located at `packages/coding-agent/examples/extensions/gemini-quota.ts`.

## 5. Security Considerations
- **Token Protection:** Ensure OAuth tokens are never logged or stored insecurely.
- **Privacy:** Project IDs and user emails used in API calls must be handled according to Google's privacy policies.
