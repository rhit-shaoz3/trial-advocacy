// What the demo account (see demo.ts) walks through on the Thrillville case,
// as the defense team: a subpoena that starts filled in, and a deposition of
// Paige Winston whose questions are filled in one at a time. The witness
// answers the scripted questions from here, not from the AI; any other
// question goes to the AI witness as usual.

/** The subpoena's starting fields; matches `DemoScript['subpoena']` in src/courses/types.ts. */
export const DEMO_SUBPOENA = {
  recipient: 'Custodian of Records, Mercy General Hospital',
  recipientDescription:
    'The hospital where Logan Crest was taken by ambulance from Thrillville on June 10, 2019, and where she had her surgeries.',
  requestType: 'documents',
  records:
    'For Logan Crest, from June 10, 2019 to the present: the ambulance run sheet and emergency room records, including any toxicology or blood alcohol results; the surgeons\' operative reports and discharge summaries; and the itemized bills for every procedure. Also any records of treatment for her back, neck, or legs in the five years before June 10, 2019.',
  justification:
    'Ms. Crest claims her broken bones and surgeries were caused by the ride. Her own medical records are the best evidence of what injuries she actually had, how they happened, what the treatment cost, and whether she had any earlier injuries or had been drinking. The request is limited to her and to the injuries she has put at issue, so it is not overbroad, and the hospital can produce the records with no undue burden.',
}

/** One question and the witness's answer; `objection` is her counsel's, as "Name: text". */
export interface ScriptedTurn {
  question: string
  objection?: string
  answer: string
}

/** How many of the questions are asked live in the demo; the rest are added when the interview ends. */
export const LIVE_QUESTIONS = 5

/** The deposition of Paige Winston by Thrillville's counsel, in order. */
export const DEPOSITION: ScriptedTurn[] = [
  {
    question: 'Ms. Winston, how do you know Logan Crest?',
    answer: "She's my best friend. We grew up together in Colorado, and we take a trip together every summer.",
  },
  {
    question: 'Why did the two of you go to Thrillville in June 2019?',
    answer:
      'Logan wanted to ride Atlas Adventure again for her blog, Logacoaster. She wanted pictures and video for her followers. I just went along with it.',
  },
  {
    question: 'Did either of you have anything to drink before getting on the ride that morning?',
    answer: "No. We got there around 8:30 in the morning. I hadn't had anything, and I didn't see Logan drink anything either.",
  },
  {
    question: 'Did you hear the operator give the safety instructions before the ride started?',
    answer: 'He gave them, but it was hard to hear over the crowd. The safety bar came down over our laps and everything seemed normal.',
  },
  {
    question: 'Was Logan holding her phone during the ride?',
    objection: 'Ms. Park: Objection, form. You can answer.',
    answer: "I didn't see her with it during the ride. I saw it later on the side of the pool, but I don't know how it got there.",
  },
  {
    question: 'Where was the operator when the raft came down into the splash pool?',
    objection: 'Ms. Park: Objection, calls for speculation.',
    answer: "I don't know. I was looking ahead at the water. I'd seen him running around before we boarded, like he was in a rush.",
  },
  {
    question: 'What happened when the raft hit the water?',
    answer:
      'It rocked really hard. Logan screamed, and she got thrown out. Her foot caught me in the face on the way and knocked my glasses off.',
  },
  {
    question: 'Did you see whether Logan\'s safety bar was down when she was thrown?',
    answer: "I didn't see it. It all happened in a second. My bar was still on me, I know that, because I couldn't get out right away.",
  },
  {
    question: 'Had Logan ever loosened or lifted a safety bar on a ride before?',
    objection: 'Ms. Park: Objection, form.',
    answer: "Not that I've seen. She takes a lot of video on rides, but I've never seen her mess with the bar.",
  },
  {
    question: 'How long did it take for park staff to reach her?',
    answer: 'It felt like a long time, maybe a minute or two. I jumped into the pool to get to her before anyone else did.',
  },
  {
    question: 'What did the operator say when he got there?',
    answer: 'He said something like, "How the hell did that happen?" He didn\'t seem prepared for it at all.',
  },
  {
    question: 'What injuries did you have?',
    answer: 'Bruises and some cuts on my face from the kick. Nothing like Logan. She broke several bones and has had surgeries.',
  },
  {
    question: 'You were a plaintiff in this lawsuit at one point, correct?',
    answer: 'I was. I settled with Thrillville. I just wanted to be done with it.',
  },
  {
    question: 'Why did you decide to settle?',
    objection: 'Ms. Park: Objection. The terms of the settlement are confidential. You can answer generally.',
    answer: "I didn't want to drag it out. It's been exhausting, and I wanted to move on.",
  },
  {
    question: 'Has Logan talked to you about why she wants to go to trial?',
    answer: 'She wants her bills covered. She also said a trial would be good publicity for her blog.',
  },
  {
    question: 'Did she ask you to stay in the lawsuit with her?',
    answer: 'She tried to convince me to keep suing. I told her I was done. We\'re still friends, but it\'s been hard.',
  },
  {
    question: 'Had you two had any problems with park staff before this trip?',
    answer:
      'The summer before, someone spilled a drink on me at one of the park bars and things got heated. It was not a big deal.',
  },
  {
    question: 'Did you ride Atlas Adventure on that earlier trip?',
    answer: "Logan did, a few times. I rode it once. It didn't feel as rough that time.",
  },
  {
    question: 'Is there anything about the ride that day you think was different from the year before?',
    objection: 'Ms. Park: Objection, vague.',
    answer: 'The end was a lot rougher. When we hit the water it shook way more than I remembered.',
  },
  {
    question: 'Is there anything else about that day you think we should know?',
    answer: 'Just that I feel guilty for going along with it. I hope this gets resolved soon so we can all move on.',
  },
]

/** The scripted turn for a question asked word for word, if there is one. */
export function scriptedTurn(question: string) {
  return DEPOSITION.find((t) => t.question === question.trim()) ?? null
}
