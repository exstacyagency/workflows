"use client";

import { WebChatPanel } from "@/components/chat/WebChatPanel";

/**
 * SupportWidget
 *
 * Renders the support agent chat panel as a fixed floating button.
 * Mount once in the root layout so it's available on every page.
 *
 * Session key produced: support:webchat-{userId}
 */
export function SupportWidget() {
  return <WebChatPanel agentId="support" />;
}
