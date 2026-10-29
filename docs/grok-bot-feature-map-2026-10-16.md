# Grok Bot — full feature map, architecture, reliability (2026-10-16)

Operator ask: "research all the features and architecture of grok bot app — this one needs to look and act like it with all features and backend reliability". This is research for TF-096 only. We copy the product and its architecture into TermFleet's agents mode; we never connect to Grok Bot.

**Sources.** All 25 official pages listed in https://docs.x.ai/llms.txt. Cited below as DOC <page> = https://docs.x.ai/grok-bot/<page>.md. Also about 30 threads on forum.cursor.com (forum <id> = https://forum.cursor.com/t/<id>), the Grok Bot 101 guide screenshots, and reviews by Flavio Copes, Composio, eesel and Toolradar. [INF] marks an inference.

Grok Bot is built and run by Cursor (Anysphere) on Cursor accounts and cloud.

## 1. Features

### Onboarding and account
- **Install:** dmg, exe (x64/Arm64), or Linux .deb/.rpm/AppImage with a signed apt/yum repo (DOC get-started, deployment).
- **Sign in:** a browser login, then back to the app. SuperGrok users see "Link Grok Account". Sign-in is blocked when Legacy Privacy Mode is on.
- **First-run tour:** covers Bots, the shared computer and routines, then asks "which tools do you use?" (that only seeds suggestions). It ends at "Meet a future teammate", which shows suggested bots plus "Create your own". The computer is being built during the tour.
- **Primary Bot:** one bot gets a star badge and works proactively. Its menu says "Replace with different Bot" instead of Delete. It also receives @bot tags from X.
- **Multiple accounts:** switch, add or remove accounts.

### Bot roster and sidebar
- **Create a bot:** New (Cmd/Ctrl+N), then "Create new Bot". The profile has a name, an optional label, a description (its standing rules) and an avatar. On the phone: + → New Bot.
- **States:** each bot shows Needs attention (a question, approval or handoff), Unread activity (a new result), or working/typing. Opening a chat marks it read; you can also mark read or unread by hand.
- **Pin and hide:** pinned bots go to the top. Hidden bots move to a "Hidden Bots (N)" section and keep running, routines included. The phone has an empty state with "Show Hidden Bots".
- **Sections:** the sidebar has named groups (e.g. "Cursor", "Ops"). Each row shows the avatar, bold name, time on the right and a gray one-line preview.
- **Duplicate:** makes "<name> copy" with the profile, settings, skills, routines and avatar. Chat history, memory and attachments are not copied.
- **Delete:** removes the profile, chat and routines. Files and logins on the computer stay. The docs recommend hiding instead.
- **Templates:** Share → Create template (public or team-only). The other person previews it, then "Add to Grok Bot" makes their own copy. A Marketplace lists templates.
- **Team Bot:** set up with Plugins, Secrets, Skills and Files cards, then Publish. It can have managers and its own Slack app. Memory is split into team memory and private notes per person.

### Chat
- **Composer:** "Message <Bot>", with + to attach and a mic button. `/` picks a skill; `@` picks a bot, group, routine or connector. Enter sends, Shift+Enter adds a new line, Cmd+Enter sends from anywhere.
- **Drafts:** unsent text is kept per chat.
- **Steering mid-run:** a message sent while the bot works redirects the current turn. "Stop now" ends it but does not undo what was already done.
- **What the transcript shows:** tool activity, computer use, created files, questions, approvals, voice memos, file and link cards (with hover previews), and a Cloud Agent card ("Running", "Open in Cursor").
- **Inline cards:**
  - Choice cards (option pills with a ✓, then "You picked …").
  - Step-by-step forms for typing into a web page.
  - Secure secret fields (masked, never shown in the transcript or to the model).
  - Email and Slack drafts with editable recipients and body, plus Send and Discard (never in groups).
  - Spend requests through Stripe Link, approved card by card (US only).
- **Voice:** dictation (Cmd+D). Live voice chat only when the composer is empty, shown as "Voice chat in progress" in the sidebar and a card afterwards. Bot voice memos play and show a transcript.
- **Threads and reactions:** reply in a thread to a specific result or approval. Users find the threads UI weak.
- **Attachments:** up to 6 at a time. Documents and images up to 25 MB, video up to 200 MB. The iOS share sheet works; Android shares text only.
- **Search:** the Cmd+K palette covers bots, groups, messages, files, links, routines, settings and actions. Cmd+Shift+F searches bots. Mobile has filters: All, Messages, Bots, Group Chats, Files, Routines.
- **Groups:** 2–6 bots, with @bot, @everyone and Reply. A group has no approvals, secret requests or drafts.
- **Bot-to-bot handoff:** the receiving bot wakes asynchronously and the handoff is visible. An admin switch, "Messaging Between Bots", can turn it off. A non-urgent message does not wake the other bot (forum 174751).
- **Errors:** they stack above the composer under "Notifications" with "Copy request ID". A failed message shows "Message failed to send" with Resend.

### Right pane ("Conversation details", Cmd+Shift+I)
- **Screen:** a "<Bot>'s screen" thumbnail that opens into a live view. Take over → do the step yourself → "I'm done" (used for passwords, 2FA, CAPTCHA and payments). Each bot runs one computer-use task at a time.
- **Teach a task:** records up to 10 minutes of screen actions (no microphone) and turns them into a draft skill. Desktop only.
- **Routines list:** a green clock, a name and a schedule ("Weekdays at 9:00 AM").
- **Routine editor:** Active toggle, Delete, Test run, Name, Instruction, "When to run" (+ add another), and run history with ✓ marks.
  - Limits: 50 routines per bot, last 20 runs kept, runs at least 5 minutes apart, delete cannot be undone.
  - On the phone you can only pause or delete.
- **Bot settings:** avatar, name, title, description, and a toggle for "Get notified when … needs input".
- **Event triggers:** a Slack message or a GitHub notification. Webhook triggers are a user request (forum 174716).

### Settings and other surfaces
- **Settings (Cmd+,):**
  - General: account; appearance (system, light, dark); language (20+); timezone; Execution on Local Computer; the Auto-review rules table; security key.
  - Computer: route traffic through this computer; computers list; Update or Reset the bot's computer.
  - Usage & Billing (weekly usage) and Updates.
  - There is no model picker.
- **Auto-review rules:** "Ask first" and "Allow automatically". Ask first wins. Admin rules are locked ("Required by your admin").
- **Connect apps (Cmd+Shift+M):** browse → add → sign in through OAuth. "Your plugins" lets you manage plugins and private skills and switch single tools on or off. Plugins are account-wide.
- **Notifications:** a push notification per bot when it finishes or needs input, suppressed while the app is focused. The dock badge counts unread chats; muted bots are not counted.
- **Keyboard:** Cmd+K, Cmd+Shift+F, Cmd+N, Cmd+F, Cmd+B (compact sidebar), Cmd+I/L, Cmd+1–9, Alt+↑/↓, Cmd+[ ], Ctrl+Tab, Cmd+Shift+M, Cmd+Shift+, (bot settings), Cmd+D, zoom, F11.
- **Recovery screens:**
  - "Starting your computer" and "Updating your computer".
  - Unreachable, with Retry and Recover computer.
  - "Update required" blocks the whole window.
  - "Another action on your computer is in progress".
  - "Your computer's files aren't ready".
- **Local computer permission:** "Allow Grok Bot and all Bots to run commands on your local computer?" with Always allow, Allow once, Never or Deny once. Can be set per computer.
- **Other:** tag @bot on X; an agent email inbox (admin, off by default).

## 2. Architecture
- **Thin clients over a cloud brain.** Desktop and mobile only show chats and approvals. Chat history and bot state are stored on Cursor's servers ("chat history is stored on our side", forum 171840). A full-account rollback synced to every device at once (171008).
- **One persistent Firecracker microVM ("sand") per user,** 16 GB RAM and 8 cores (174573, 174170).
  - Folders: `/workspace` and the `box` user's home directory; skills and memory live in `~/sand-data/workflows` (173700).
  - Processes: `sand-host/host-main.cjs`, with one `exec-daemon serve` per agent.
  - Each bot gets its own Xvfb + xfwm4 + x11vnc + Chrome desktop (174574).
  - Network: hosts are `<computer>.<cluster>.cursorvm.com` over streaming connections; chat runs as SSE through api2.cursor.sh.
  - [INF] The live screen is a VNC stream.
- **Durable disk and snapshots.**
  - Idle computers hibernate. A stale image is recreated from a fresh image with files kept. Reset rebuilds from the last snapshot. The control plane is backed up daily.
  - Update first takes a full backup and refuses to run if that backup fails ("files aren't ready", 174730).
  - Recreate pauses a bot at a safe point mid-turn and resumes it on the new computer; it fails rather than lose the turn.
- **Sleep and wake.** The computer pauses a few minutes after the app disconnects if no bot is working; nohup processes do not count as work (174272). Automatic updates run only when idle, about once a day.
- **Scheduler.** Runs are queued centrally into a "reserved slot a few minutes out", added after silent skips (170358).
  - Wake-ups come from a schedule, a trigger, a message from another bot, or a finished delegated job (172009).
  - A bot cannot set its own future wake-up (174751).
- **Local host.** The desktop app runs a supervisor plus a local-exec-daemon as Node utility processes (`~/.grokbot/local-exec-daemon.log`); `gateway-descriptor.json` caches the route.
  - Known bug: when the window has been unfocused for about 10 minutes or the screen is locked, the helper is stopped and not restarted for background jobs (174223).
- **Connectors** are MCP servers. OAuth tokens stay on the backend and never reach the computer.
- **Approvals.** An independent "Auto Review" model checks shell commands, plugin calls, computer use, routine and trigger writes, and delegation, then allows, asks or denies.
  - Unattended approvals expire after about 10 minutes; attended ones wait.
  - Outside content is marked as untrusted.
- **Versioning.** The desktop app shows "Restart to Update", and a remote kill-switch can force "Update required". The VM image updates separately and silently.

## 3. Reliability
- **What the docs claim:**
  - Work continues with the laptop closed.
  - Update and Recover keep files and logins; Reset can lose unsynced work.
  - Recreate resumes at a safe point.
  - Retry never duplicates work, and only one operation runs per team at a time.
  - Setup is idempotent: check scripts run first and retry on refresh.
  - Skills should make retries idempotent, report partial completion, and have a policy for missing or stale data.
- **Recovery ladder:** Retry → restart the app → Recover computer (offered only from the error state) → Update the computer → wait → Reset as a last resort.
- **Failures seen in the field:**
  - Computer unreachable for hours or days (169450, 170258, 174633).
  - "Failed to send": one stuck step blocks that bot's whole queue (171858, 187 posts; 171840).
  - A 24-minute delivery delay caused by a huge memory folder (173700).
  - An account history rollback (171008).
  - Duplicate computers ran routines twice and split chats between devices (170989).
  - A silent snapshot rollback after the disk filled lost days of work (173623, 174856, 174060).
  - The disk shrank to 16 GB (173656).
  - All outgoing ports blocked except 443 (173504).
  - Per-bot desktops leak memory and never close (174574).
  - Routines ran late or were silently skipped (170358), or lacked tools that chat has (174363).
  - Stop took about 30 seconds or needed a restart (174980).
  - A stale "Approval needed" badge stayed after the approval expired (170127).
  - Approvals expired before the user saw them, so users want a configurable timeout (169864).
  - Push notifications were missing, or suppressed while the app was in front (168245).
  - Old scheduled tasks replayed (175003).
  - Update needed about four presses (173562).
  - The local daemon kept restarting (174223, 168583).
  - Staff advice in these threads: "don't press Reset"; they fix things server-side or restore a saved point.

## 4. Visual design (Grok Bot 101 screenshots)
- **Layout:** three panes. A left sidebar of about 240 px, the chat in the center, and a collapsible right details pane of about 300 px.
- **Sidebar:** search plus "+" at the top. Rows show a round colorful blob avatar with dot eyes, a bold name, the time and a gray preview. Small gray section headers group the rows. "Hidden Bots N", Plugins and the user sit at the bottom. The selected row has a light gray fill.
- **Chat:** light theme. Bot messages are light-gray rounded bubbles on the left; user messages are black pills with white text on the right. Gray timestamp dividers separate the day. Screenshots appear as rounded image cards, and choice cards carry a ✓. The cloud-agent card has a blue "Running" chip.
- **Composer:** a rounded pill with + on the left and a black round mic button.
- **Right pane:** the screen thumbnail, then the routines list or the settings form. Primary buttons are solid black, secondary buttons gray, and the Active toggle is black.
- **Type and color:** system sans, mostly grayscale; avatars and small accents (a green clock, blue for running) carry the color. [INF] Motion is minimal.

## 5. Gaps versus TermFleet

TermFleet already has: an agent list with needs-you, working and idle states; a chat per agent; rooms with @mentions; scheduled messages; an inbox; a live screen; dictation; the new-answer dot; a profile with name, job and rules; a handoff command; and the sure gate.

**Gaps:**
1. **Approvals:** inline approval cards (Allow once, Always allow saved as a rule, Deny) that expire after about 10 minutes when unattended, show an "Expired" state, and offer "Always allow in future".
2. **Rules table:** "Ask first" and "Allow automatically", where Ask first wins.
3. **Stop:** a Stop that verifiably halts within seconds, with a confirmed-stop state.
4. **Routine manager:** Active toggle, Test run, several times per routine, run history of the last 20, next run, at least 5 minutes apart, a cap of 50, and auto-pause after a long absence.
5. **Reliable scheduling:** reserved slots, with queued, late and skipped states shown.
6. **Self wake-up:** an agent can set its own wake-up. Grok Bot lacks this, so it is a chance to do better.
7. **Delegated work:** work handed to a helper stays visible in the parent chat.
8. **Cards:** question and choice cards, step forms, and a secure secret prompt kept out of the transcript.
9. **Drafts:** draft cards for outbound messages, with Send and Discard.
10. **Message reliability:** delivery states (sending, failed, Resend), an unsent draft per chat, and idempotent message ids.
11. **Read state:** mark read or unread manually, and keep needs-attention, unread and working separate.
12. **Threads and reactions.**
13. **Search and navigation:** a Cmd+K search palette, Cmd+1–9, Alt+↑/↓, and find in chat.
14. **Organizing the list:** pin, hide with a "Hidden (N)" section, and named sections.
15. **Duplicate and templates:** duplicate an agent; export and import its profile, rules, skills and routines.
16. **Skills in the composer:** pick skills with `/`, and "save this as a skill".
17. **Attachments:** up to 6 with size limits, plus the phone share sheet.
18. **Voice:** live voice chat, and agent voice memos with a transcript.
19. **Notifications:** an on/off per agent, quiet while the app is focused, a dock badge, and phone push.
20. **Errors:** error notices above the composer with a copyable request id.
21. **Usage:** a weekly usage meter.
22. **Health and recovery:** Starting, Reconnecting and Unreachable states, with Retry → Recover → Reset in order, and a backup gate before any update.
23. **Lessons to build in from day one:**
    - A queue per agent, so one stuck agent cannot block the others.
    - A single writer, so no duplicate runners.
    - Restart the helper on wake, not only on window focus.
    - Cap the size of memory and skills folders.
    - Clear stale badges when an approval expires.
    - Close idle per-agent resources.
24. **Phone:** approvals work on the phone; routines can be paused or deleted there.

**Not applicable:** a cloud microVM per user, Slack Team Bots, the marketplace, X tagging, and enterprise admin.
