# LaunchLab — From code to learning

176-second, 1920 × 1080, 24 fps product film authored in native Higgsedit.
Revision 3 makes https://launchlab.stardive.xyz/ the main product destination, adds an animated homepage chapter, and uses a more energetic synthwave soundtrack.

The creative reference is the owner's Stardive product film v6: editorial typography,
progressive product motion, a continuous use case, restrained transitions and motion.
This version is text-led; it does not use the first film's synthetic voice.

## Story

“A repo isn't a launch. A launch isn't validation.” The film follows the fictional
PROOF / REPS gymwear concept through a real implemented LaunchLab workflow:
public repository → pinned version and framework → bounded instrumentation plan →
approval → isolated source changes → CodeBuild / Amplify → voluntary activity and
feedback → inspectable results. Additional use cases are explicitly examples.

The opening is a product thesis, not a measured industry-wide deployment statistic.
a16z's [2025 State of Crypto](https://a16zcrypto.com/posts/article/state-of-crypto-report-2025/)
describes an adoption gap between holders and active users, alongside infrastructure
and adoption growth. It does not establish that Web3 has declining or insufficient
deployment. No invented macroeconomic statistic appears in the film.

## Evidence and representations

- Founder photograph: AI-generated illustration, not a real customer or testimonial.
- Product photographs: existing fictional PROOF / REPS demo assets.
- Store and feedback screenshots: actual internal demonstration captures.
- Animated interface sequences: labelled editorial reconstructions, not a live recording.
- Results: 25 September internal snapshot; two browser sessions, two recorded checkout
  actions (shown as 2+ because older repeats are unavailable), one saved QA response.
- These are not customers, purchases, revenue, or proof of demand.
- OKX provider registered; listing review rejected; marketplace round trip unverified.
- Separate X Layer x402 testnet readiness self-payment verified. Not a real-money
  deployment purchase, incentive payout, or production billing demonstration.
- Recruitment, incentives and automatic rewards are future work, not demonstrated.

## Production assets

`edit.jsx` is the editable native composition. Input names are documented in its
asset import list. Fonts: Geist by Vercel, SIL Open Font License (see ../video-v2/assets/OFL.txt).
Source screenshots and product assets remain in their original public-repo paths.

Generated founder image prompt (built-in image generation):

> A cinematic editorial 16:9 photograph of a fictional adult Southeast Asian founder
> working at a laptop at a minimal studio table after sunset. Folded unbranded black
> gymwear, fabric sample and notebook; Singapore blue-hour studio, subtle violet
> reflections and warm desk lamp, real skin texture, 35mm shallow focus. Subject and
> desk right; clean dark negative space left for native typography. No readable UI,
> logos, coins, holograms or text. Label as an illustrative founder, not a customer.

## Music attribution

“Electric Dreams” by Scott Buckley, released under CC BY 4.0.
[Official track](https://www.scottbuckley.com.au/library/electric-dreams/) ·
[Usage terms](https://www.scottbuckley.com.au/library/using-this-music/) ·
[License](https://creativecommons.org/licenses/by/4.0/).
Edited excerpt: trimmed, level adjusted, faded in and out. Credit is on the closing
frame, viewing page and MP4 metadata. The project does not redistribute standalone
music or claim ownership of the track. Do not register the track in Content ID.

## Rebuild

Use the installed Higgsedit runtime, reuse the fonts and founder image in `../video-v2/assets/`, and place named source assets in `input/` under
`LAUNCHLAB_FILM_DIR`, then build `edit.jsx`. Set `LAUNCHLAB_RENDER=1` for the full
silent render; otherwise native review PNGs and the editable project are generated.
The final mix uses the licensed music with 1-second entrance and 3-second exit fades. The soundtrack uses the section beginning 45 seconds into Electric Dreams, with loudness normalization at -16 LUFS.

## Website representation

The homepage chapter is a native animated editorial reconstruction of the observed public site, not a screenshot. It uses the live headline “Launch fast. Learn faster.”, launch-loop structure, brand colors and the exact domain. The live site was inspected on 25 September. Its older hosting roadmap copy is not presented as current deployment evidence. The working product flow and integration boundaries remain shown separately.
