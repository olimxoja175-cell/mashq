# Browser E2E results

| Check | Result | Detail |
|---|---|---|
| login + MFA (Uzbek president) | PASS | 1.0s |
| login + MFA (Chinese president) | PASS | 1.1s |
| create meeting with invitation | PASS | 0.8s |
| host joins room (AI consent given) | PASS | 1.2s |
| invitee accepts invitation and joins | PASS | 2.7s |
| WebRTC audio/video connected peer-to-peer | PASS | 0.6s |
| Uzbek -> Chinese interpretation delivered (subtitle + transcript) | PASS | 0.3s |
| Chinese -> Uzbek interpretation delivered | PASS | 0.4s |
| speaker never receives own translation | PASS | 0.0s |
| microphone control propagates to other participant | PASS | 0.2s |
| camera control | PASS | 1.2s |
| network interruption: reconnect, media restored, interpretation resumes | PASS | 2.0s |
| tablet and mobile layouts (no horizontal overflow) | PASS | 2.6s |
| host ends meeting | PASS | 0.1s |
| Arabic official: right-to-left interface | PASS | 1.2s |
| admin monitoring + access management + audit chain | PASS | 2.2s |
