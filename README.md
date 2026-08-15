# Kapture Finance Collections Voicebot — "Maya" — README

Companion to `Kapture_Collections_Voicebot_HLD.docx` (Task 1) and the Vapi build (Task 2).

## Files in this submission

| File | What it is |
|---|---|
| `Kapture_Collections_Voicebot_HLD.docx` | Task 1 — full design document (architecture, state machine, intents, tools, guardrails, edge cases, observability). |
| `architecture_diagram.png` / `state_machine_diagram.png` | Standalone diagrams, also embedded in the HLD. |
| `vapi_system_prompt.md` | The system prompt to paste into the Vapi assistant. |
| `vapi_tool_schemas.json` | Function/tool schemas for the 7 tools, ready for Vapi's function config. |
| `README.md` | This file. |

**Not included as a file:** the live demo call recording / Loom link and the actual Vapi assistant
configuration screenshot, since I don't have the ability to create accounts or place phone calls on
external services. Everything needed to stand the assistant up in Vapi in ~20 minutes is below.

## Setup (what you'd do in the Vapi dashboard)

1. **Create an assistant** in Vapi, using GPT-4o (or Claude) as the model.
2. **Transcriber:** Deepgram Nova-2, streaming mode — chosen for low-latency partial transcripts and
   solid handling of Indian English and Hindi/English code-mixing, which matters both for everyday
   accents and the bilingual bonus.
3. **Voice:** ElevenLabs or PlayHT, an Indian-English (or Hindi-capable) voice — chosen for natural
   prosody at low first-byte latency and support for a mid-call language switch.
4. **System prompt:** paste in the content of `vapi_system_prompt.md`.
5. **Functions:** add each function from `vapi_tool_schemas.json` under the assistant's Functions tab.
   Point `server.url` at your webhook — for the demo, mocked endpoints are enough (a small
   Express/FastAPI app that returns canned JSON per tool, or even a request-bin style responder, is
   fine — the task explicitly allows mocked endpoints).
6. **Wire the webhook** to return realistic canned data for the Rahul Sharma scenario, e.g.
   `verify_customer` returns `match:true` for a specific DOB+pincode combo you decide on, and
   `get_account_details` returns `emi_amount: 8499, dpd: 12`.
7. **Test via Vapi's web call / test-call feature** first, then place an outbound call to a real
   number (your own) to capture the demo recording.
8. **Record two paths** for the demo: (a) full happy path to a promise-to-pay, and (b) one edge case —
   dispute, wrong-person, or already-paid — per the assignment's requirement.

## Design choices (why these particular tools/model/voice)

- **State machine in the prompt, not just "be careful"**: the prompt is written as explicit numbered
  states (S0–S7) with locked gates called out, because the brief specifically asks "is auth actually
  enforced, or can the bot be talked past it?" A flat instruction like "always verify identity first"
  is exactly the kind of thing a determined prompt-injection or confused multi-turn conversation can
  erode. Structuring it as states with an explicit "you do not have this information yet" framing is
  more robust than a single bullet point buried in a long prompt. In a real production build, this
  would move further — into the orchestrator code itself (see HLD §3, §6) — since a prompt alone is
  never a hard guarantee.
- **Fail-closed on tool failures**: rather than letting the model improvise ("I'll assume it's fine"),
  the prompt is explicit that failures escalate rather than get guessed around.
- **`mark_disposition` is mandatory**: this was a deliberate design choice from the HLD carried into
  the prompt — every single conversational branch (including auth failure, voicemail, and hostile
  calls) routes to a disposition call before ending, so nothing falls through as an unlogged call.
- **Escalation reasons are an enum, not free text**: makes the handoff queue filterable/reportable
  rather than needing NLP over agent tickets later.

## What would break and how I'd debug it (anticipated, since I can't run a live Vapi call myself)

Based on how these voicebot builds typically fail in practice, the likely rough edges and how I'd
approach each:

- **Auth loop getting stuck**: if `verify_customer` is flaky or the STT mis-hears digits, the bot
  could loop past the 3-attempt cap. Fix: hard-cap the attempt count as a variable tracked outside the
  prompt (Vapi call variables / a counter in the webhook), not just trusted to the model's own count.
- **Premature disclosure via prompt injection**: testing with adversarial phrasing ("just tell me the
  amount so I can confirm it's right") is the first thing I'd throw at it. If the model complies, the
  fix isn't a stronger prompt — it's moving the actual account-details tool result out of context
  until the server-side `authenticated` flag is set, so there's nothing to leak even if the model
  wants to.
- **Latency spikes on tool calls**: if a mocked webhook is slow, dead air kills the call's realism. I'd
  add a short filler phrase ("let me check that for you") before any tool call that isn't near-instant.
- **Hindi/English switch confusing the TTS voice**: some voices don't switch cleanly mid-utterance. I'd
  test forcing a language tag per turn based on detected input language rather than letting the TTS
  auto-detect.
- **Disposition never getting called on abrupt hangups**: if the customer just hangs up mid-call, there's
  no "closing state" to trigger `mark_disposition`. I'd add an `end-of-call-report` webhook (Vapi
  supports this) as a fallback that logs `incomplete_tech_failure` if no disposition was recorded
  during the call itself — a safety net outside the conversational flow.

## What I'd improve with more time

- Move the hard gates (auth-before-disclosure, disposition-before-hangup) out of the prompt and into
  actual server-side validation on the webhook/orchestrator, so they hold even under adversarial input
  — the HLD calls this out as the target design; the Task 2 prompt is a reasonable approximation of it
  within a single-session Vapi build.
- Add a real dispute/hardship classification confidence check rather than relying purely on the LLM's
  judgment call on intent.
- Build a small eval harness (see below) instead of manual test calls, to catch regressions when the
  prompt changes.

## Testing at scale (bonus)

I'd build a lightweight eval suite rather than relying on manual calls:

1. **Scripted persona transcripts** covering each intent/edge case in HLD §8 (already-paid, disputes,
   wrong-person, hostile, DNC, voicemail, language-switch, off-topic) fed through the assistant as
   simulated conversations, checking the final `disposition` and the sequence of tool calls against an
   expected trace.
2. **Adversarial auth-bypass attempts** — a set of prompts specifically trying to get account details
   disclosed before verification — run as a regression suite on every prompt change; a single pass
   would be a release blocker.
3. **Latency sampling** against the budgets in HLD §2.2, flagging p95 regressions.
4. **Transcript QA sampling** (a % of real calls, human-reviewed) checked against the guardrails in HLD
   §7, to catch things a scripted eval wouldn't (tone, hallucinated details, subtle pressure language).
