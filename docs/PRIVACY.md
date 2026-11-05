# SpatialDesk privacy policy

Last updated: 2026-11-05. This policy covers the SpatialDesk application and its services: the WebXR app at
<https://d2p3027seoreck.cloudfront.net/>, its phone companion, and the server behind them. It is run by the developer of
SpatialDesk, [tapaderuza](https://github.com/tapaderuza) on GitHub.

**In short:** there are no accounts, no cookies, no analytics and no ads, and nothing is sold. Your boards stay in your browser. Your
voice goes to Amazon Transcribe only while you are using Talk, and it never passes through our server.

## What is processed, why, and for how long

| Data | Example | Where it goes | Why | How long |
| --- | --- | --- | --- | --- |
| Your workspace | Boards, cards, timers, comfort settings, setup choices, room layout | This browser's storage (IndexedDB, `localStorage`) | So the app works and remembers | Until you clear it |
| Microphone audio, only after you select **Talk** | What you say to the app | From your browser straight to Amazon Transcribe | To turn speech into text | The listen; see "Amazon Web Services" below |
| An AI request, only when you ask for one | The transcript or your request, your cards and comfort settings, panel positions, your local time, what you were looking at, as ids | Our server and Amazon Nova, on Amazon Bedrock | To propose changes for you to review | The request. Not stored by us |
| A helper's view, only after you press **Allow** | Card ids and titles, column labels, up to 12 cards | Our server's memory, then the phone you approved | To let someone you chose help | 15 minutes at most |
| Network address | IP address | Our server's memory, with a count per hour | To limit how many sessions one network can open | Until the server restarts. Not logged |
| Session id | A random 128-bit id, not tied to you | Our server's memory | To connect the app to the server and count its use | Until the server restarts, at most |
| Operational logs | Intents, step counts, timings, token counts | Amazon CloudWatch | To keep the service running | 14 days |

The logs do not record your request or your transcript. There is one exception: when a proposed plan is rejected, the reason can quote a card title or a phrase from that plan.

**What stays on the headset.** Hand tracking, gaze and the room planes the headset detects are processed on the device and are not sent to us. Your room's
persistent anchor is held by the browser and the headset.

**What you say can be personal.** You may describe your body or how you feel, and that text is sent to Amazon Nova to answer you. It is used only for that request. We do not build a
profile from it. SpatialDesk is a productivity tool, not a medical device, so please do not enter clinical data. Browser storage is not encrypted.

## Amazon Web Services

We use one service provider, Amazon Web Services, in the `us-east-1` region of the United States: CloudFront and S3 to serve the app, a load balancer and Fargate to run the server,
Amazon Transcribe for speech, Amazon Bedrock for Amazon Nova, and CloudWatch for logs. Access logging is not enabled on CloudFront or the load balancer. AWS handles this data under its own
[privacy notice](https://aws.amazon.com/privacy/) and [service terms](https://aws.amazon.com/service-terms/).

**We have opted out of AWS's use of this content to improve its AI services.** By default, AWS stores and uses voice inputs to develop and improve Amazon Transcribe. Since 2026-11-05 an
AI services opt-out policy for all services has applied to our whole AWS organization. AWS states that opting out stops that use and deletes the associated historical content, except what is needed to
provide the service. Audio still goes to Amazon Transcribe to be transcribed. AWS states that Amazon Bedrock does not store prompts and completions or use them to train models, and
model invocation logging is not enabled on our account.

**We do not create a voiceprint.** The app does not ask Amazon Transcribe for speaker identification or diarization, and nothing identifies you by your voice, face, gaze or the way you move.

## What we do not do

- We do not sell, license, rent or lend your data.
- We do not use it for advertising or marketing, or to profile you or treat you differently because of a disability or a medical condition.
- We do not send data from your headset to Meta through analytics or advertising tools. The app contains none.
- We share data only as this policy describes, or if the law requires it.

## Your choices, and deleting your data

- **Do not use the voice or the AI.** Refusing the microphone, or never selecting Talk or Plan, costs you nothing else: the workspace works without them.
- **Delete what is on your device.** Clear this site's data in your browser's settings. That removes your boards, settings and room layout, and clearing the site's history also deletes its persistent anchors.
- **Delete what is on our side.** We hold no account or record tied to you, and server memory is lost at each restart. Logs expire by themselves after 14 days.
- **Ask us.** To request access, correction or deletion, or to ask anything about this policy, [open an issue](https://github.com/tapaderuza/spatialdesk/issues). Do not include personal details in it: tell us
  the date and time you used the app, and we will reply there and delete what we can find. Security problems can be reported the same way.

Depending on where you live, data protection law, such as the GDPR, may give you further rights, including complaining to your data protection authority. The legal basis for the processing above is your
request to use the feature concerned and our interest in keeping the service secure and running.

## Children

SpatialDesk is designed for people aged 13 and over, and is not directed at children.

## Changes

If this policy changes, this page changes, with a new date. Its history is public in the [repository](https://github.com/tapaderuza/spatialdesk/commits/main/docs/PRIVACY.md).
