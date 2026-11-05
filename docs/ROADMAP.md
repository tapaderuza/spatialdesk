# Roadmap

**Nothing on this page is built yet.** It is the order we would do things in, and why. The application is under feature freeze for judging, so every item below
that changes the code waits until the freeze ends. For what ships today, see the [README](../README.md).

## 1. Defects already found

These come first, because they are known. Each is recorded with its evidence in the [engineering audit](ENGINEERING_AUDIT.md).

| Defect | Change |
| --- | --- |
| The pinch after a slide-off is lost | Report it upstream |
| The per-network limit lives only in the deployed task's environment | Move it into `SpatialDeskStack.kt` |
| No Content Security Policy; a dependency advisory; no alarms on this stack | Add a policy, update `zod`, add alarms on 5xx and unhealthy hosts |

Before a Store listing, Meta also asks for an age group, an IARC rating, a privacy policy link in the submission, and a Data Use Checkup if the app uses Platform SDK features. A link to the [privacy policy](PRIVACY.md) belongs on the app's own page.

## 2. Hardware validation

The largest unknown, and the [hardware document](HARDWARE_MITIGATION.md#5-what-only-a-headset-can-settle) lists its checks and criteria: frame rate and GPU cost on a real Quest 3 in
VR and in passthrough, thermal behaviour over 10 minutes, pinch reliability, Fit room in rooms we have never seen, and anchors across a reboot.

## 3. Studies with people

No study has been run. Before claiming that the product helps anyone, it needs a study, designed with disabled participants and paid for their time:

- Do people with changing reach, posture or energy find it useful, on a good day and on a hard one?
- Is steady aim better for real tremor, as the synthetic model suggests?
- Is it comfortable over a real work session?

## 4. Accessibility coverage

- **Expose what is already built.** Dwell time, scan interval, reduced motion, mono audio and reading scale are implemented, validated and tested as stored preferences, with no control in this build.
- **One-switch scanning for the boards.** Today it covers the command panel and the agent's card.
- **A contrast audit,** which has not been done.
- **An external accessibility review** against WCAG 2.2 and XAUR.

## 5. Reliability, beyond a competition deployment

- **Offline first load:** a service worker, so the page opens with no connection.
- **Sessions that survive a restart:** a shared store for sessions and quota counts, and more than one task.
- **Observability:** alarms and a dashboard for this stack.
- **A security review:** a penetration test, a WAF on the session endpoint, and a server-side limit on stream length if that is possible.

## 6. Product questions, still open

These need evidence from sections 2 and 3 before they deserve a plan: which devices beyond Quest to support, what a helper should be able to do with the owner's consent, whether a workspace should sync between
devices, and what a sustainable pricing model would be for the people this is for.
