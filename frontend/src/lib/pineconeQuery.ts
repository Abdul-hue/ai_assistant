import { API_URL } from "@/config";
import type {
  AgentDocumentMatch,
  AgentDocumentQueryResponse,
} from "@/types/agent.types";

interface QueryOptions {
  topK?: number;
}

export async function queryAgentDocuments(
  agentId: string,
  query: string,
  options: QueryOptions = {}
): Promise<AgentDocumentMatch[]> {
  const topK = options.topK ?? 5;

  const response = await fetch(`${API_URL}/api/agent-documents/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({
      agent_id: agentId,
      query,
      top_k: topK,
    }),
  });

  const payload: {
    success?: boolean;
    error?: string;
    message?: string;
    data?: AgentDocumentQueryResponse;
  } = await response.json().catch(() => ({}));

  if (!response.ok || payload.success === false) {
    throw new Error(
      payload.error || payload.message || "Failed to query agent documents"
    );
  }

  return payload.data?.matches ?? [];
}


