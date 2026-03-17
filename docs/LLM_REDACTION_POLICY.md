# LLM Redaction Policy

This document describes what data is sent to Anthropic today, what is intentionally not sent, and why those transfers occur.

## Scope

This policy applies to current Anthropic-backed workflows in the repo, including:

- customer analysis
- pattern analysis
- script generation
- storyboard generation
- product data collection
- ad quality gate
- swipe metadata extraction
- some prompt-generation helpers

## Summary

The platform sends only the minimum working prompt context needed to produce the requested output.

Current rule:
- redact secrets and credentials completely
- do not intentionally send session tokens, API keys, database credentials, or internal auth secrets
- send project content, creative inputs, and research content when needed to perform the user-requested task

This is a product-generation platform, so some customer/project content is intentionally sent to the LLM in order to generate scripts, storyboards, analyses, and product intelligence.

## Data that may be sent to Anthropic

Depending on the job, Anthropic may receive:

- user-provided product/problem descriptions
- product names and brand-language inputs
- research summaries and selected research rows
- ad transcripts
- ad OCR text
- ad performance context used for pattern analysis
- swipe-template transcript content
- script scenes / `vo` / beat structures
- character name and character description
- storyboard beat timing and panel instructions
- fetched product-page HTML/text content for product data collection
- prompt-context text synthesized from prior internal results

Why:
- the model cannot generate the requested output without the source creative/research context

## Data that should not be sent to Anthropic

The platform should not intentionally send:

- API keys
- access tokens
- session cookies
- NextAuth secrets
- database connection strings
- Stripe secrets
- AWS secrets
- raw `.env` contents
- internal debug/admin tokens
- Redis URLs or passwords
- provider bearer tokens

These are not part of the intended prompt payloads and should be treated as prohibited data for LLM prompts.

## Authentication and user-account data

The platform does not intentionally send:

- password material
- auth secrets
- session tokens

User account identifiers such as email should not be included in Anthropic prompts unless a future feature explicitly requires it and is separately documented.

## Logging behavior

Current implementation reality:

- some services log prompt/response metadata and debug traces
- the repo still contains broad `console.log` usage in several workers/services
- therefore this policy should be read as the intended rule, not a claim that logging is fully hardened everywhere today

Target rule:
- log only high-level metadata
- never log secrets
- avoid logging full raw prompts containing unnecessary customer content
- sanitize/truncate external failure text

## Redaction standard

Before data is sent to Anthropic:

- exclude credentials entirely
- exclude infra/config secrets entirely
- prefer derived summaries over unrelated raw records
- include only the rows, transcripts, or product text needed for the current job

When a future feature can be fulfilled with either:
- a summary, or
- a full raw body

the preferred option is the summary.

## Why some customer data is still sent

This platform is not a general-purpose analytics store; it is a generation system. That means the model must receive certain customer/project content to do its job.

Examples:

- script generation needs research findings, target product context, and swipe template context
- storyboard generation needs script beats, VO, and character/product references
- product data collection needs product-page text/HTML to extract structured product intelligence
- pattern analysis needs transcript/OCR/performance context from ads

So the correct policy is not “send nothing,” but rather:

- send only task-relevant business content
- never send secrets or operational credentials

## Current gap disclosure

This document establishes the current policy intent.

It does not claim that every Anthropic call path is already programmatically redacted in a uniform middleware layer. That remains a hardening opportunity. The current system mostly relies on:

- prompt construction inside each service
- the fact that secrets are not part of normal business payloads
- selective prompt assembly rather than whole-database dumps

## Buyer disclosure

Buyer should understand:

- Anthropic receives selected business/project content necessary to perform generation and analysis tasks
- Anthropic is not intended to receive platform secrets or credentials
- further centralization of prompt redaction and prompt logging hygiene is still a reasonable post-transfer hardening step
