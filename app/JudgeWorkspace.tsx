"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type EventType = "PF" | "LD";
type AudioSource = "tab" | "microphone";
type TranscriptionEngine = "browser" | "openai" | "demo";
type Stage = "setup" | "round" | "decision" | "ballot";
type SideKey = "A" | "B" | "Both";
type SpeechStatus = "upcoming" | "active" | "complete";

type RoundSetup = {
  event: EventType;
  tournament: string;
  resolution: string;
  teamA: string;
  teamB: string;
  speakersA: string[];
  speakersB: string[];
  audioSource: AudioSource;
  authorized: boolean;
  judgeOwnsDecision: boolean;
};

type Speech = {
  id: string;
  label: string;
  shortLabel: string;
  side: SideKey;
  minutes: number;
  speakerIndex: number | null;
  transcript: string;
  notes: string;
  status: SpeechStatus;
};

type ArgumentItem = {
  id: string;
  side: string;
  claim: string;
  support: string;
  status: "introduced" | "contested" | "extended" | "possibly_unanswered";
  transcriptQuote: string;
};

type ResponseItem = {
  side: string;
  target: string;
  response: string;
  status: "answered" | "partial" | "possibly_unanswered";
};

type VotingIssue = {
  title: string;
  comparison: string;
  verify: string;
};

type TeamReview = {
  strengths: string[];
  improvements: string[];
  nextRoundFocus: string;
};

type JudgeReview = {
  suggestedWinner: "A" | "B" | "no_recommendation";
  confidence: "low" | "moderate" | "high";
  headline: string;
  roundReview: string;
  winnerReasoning: string[];
  teamA: TeamReview;
  teamB: TeamReview;
  caveat: string;
};

type Analysis = {
  summary: string;
  arguments: ArgumentItem[];
  responses: ResponseItem[];
  votingIssues: VotingIssue[];
  newArgumentAlerts: string[];
  feedback: {
    strengths: string[];
    improvements: string[];
  };
  judgeReview: JudgeReview;
  source: "openai" | "local" | "sample";
};

type BallotDraft = {
  rfd: string;
  oralDisclosure: string;
  feedback: Array<{
    speaker: string;
    strengths: string;
    improvements: string;
  }>;
  source: "openai" | "local";
};

type SavedState = {
  setup: RoundSetup;
  stage: Stage;
  speeches: Speech[];
  activeSpeechId: string;
  analysis: Analysis;
  winner: SideKey | "";
  selectedIssues: number[];
  points: Record<string, number>;
  ballot: BallotDraft | null;
};

type BrowserSpeechResult = {
  isFinal: boolean;
  0: { transcript: string; confidence: number };
};

type BrowserSpeechEvent = {
  resultIndex: number;
  results: { length: number; [index: number]: BrowserSpeechResult };
};

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  processLocally?: boolean;
  onstart: (() => void) | null;
  onresult: ((event: BrowserSpeechEvent) => void) | null;
  onerror: ((event: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type BrowserSpeechConstructor = {
  new (): BrowserSpeechRecognition;
  available?: (options: { langs: string[]; processLocally: boolean; quality?: "conversation" }) => Promise<"unavailable" | "downloadable" | "downloading" | "available">;
};

function getBrowserSpeechConstructor() {
  if (typeof window === "undefined") return null;
  const speechWindow = window as Window & {
    SpeechRecognition?: BrowserSpeechConstructor;
    webkitSpeechRecognition?: BrowserSpeechConstructor;
  };
  return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition || null;
}

const STORAGE_KEY = "judgeflow-round-v1";

const EMPTY_JUDGE_REVIEW: JudgeReview = {
  suggestedWinner: "no_recommendation",
  confidence: "low",
  headline: "Complete the transcript before requesting a recommendation.",
  roundReview: "JudgeFlow needs both sides' arguments to write a comparative review.",
  winnerReasoning: [],
  teamA: {
    strengths: [],
    improvements: ["Complete or paste this side's speeches so the review can cite the round."],
    nextRoundFocus: "Build a clear claim, warrant, impact, and final comparison.",
  },
  teamB: {
    strengths: [],
    improvements: ["Complete or paste this side's speeches so the review can cite the round."],
    nextRoundFocus: "Build a clear claim, warrant, impact, and final comparison.",
  },
  caveat: "This is an advisory review. The human judge verifies the flow and makes the decision.",
};

const EMPTY_ANALYSIS: Analysis = {
  summary: "Complete a speech, then ask JudgeFlow to organize the round.",
  arguments: [],
  responses: [],
  votingIssues: [],
  newArgumentAlerts: [],
  feedback: { strengths: [], improvements: [] },
  judgeReview: EMPTY_JUDGE_REVIEW,
  source: "local",
};

const DEFAULT_SETUP: RoundSetup = {
  event: "PF",
  tournament: "Quarry Lane Invitational",
  resolution: "",
  teamA: "Team A",
  teamB: "Team B",
  speakersA: ["Pro 1", "Pro 2"],
  speakersB: ["Con 1", "Con 2"],
  audioSource: "microphone",
  authorized: false,
  judgeOwnsDecision: false,
};

const DEMO_SETUP: RoundSetup = {
  event: "PF",
  tournament: "Quarry Lane Invitational",
  resolution:
    "Resolved: The United States federal government should substantially increase its investment in domestic nuclear energy.",
  teamA: "Pro / Team A",
  teamB: "Con / Team B",
  speakersA: ["Pro 1", "Pro 2"],
  speakersB: ["Con 1", "Con 2"],
  audioSource: "tab",
  authorized: true,
  judgeOwnsDecision: true,
};

const PF_SPEECHES: Array<Omit<Speech, "transcript" | "notes" | "status">> = [
  { id: "pf-pro-constructive", label: "Pro Constructive", shortLabel: "PRO C", side: "A", minutes: 4, speakerIndex: 0 },
  { id: "pf-con-constructive", label: "Con Constructive", shortLabel: "CON C", side: "B", minutes: 4, speakerIndex: 0 },
  { id: "pf-crossfire-1", label: "Crossfire", shortLabel: "CF 1", side: "Both", minutes: 3, speakerIndex: null },
  { id: "pf-pro-rebuttal", label: "Pro Rebuttal", shortLabel: "PRO R", side: "A", minutes: 4, speakerIndex: 1 },
  { id: "pf-con-rebuttal", label: "Con Rebuttal", shortLabel: "CON R", side: "B", minutes: 4, speakerIndex: 1 },
  { id: "pf-crossfire-2", label: "Crossfire", shortLabel: "CF 2", side: "Both", minutes: 3, speakerIndex: null },
  { id: "pf-pro-summary", label: "Pro Summary", shortLabel: "PRO S", side: "A", minutes: 3, speakerIndex: 0 },
  { id: "pf-con-summary", label: "Con Summary", shortLabel: "CON S", side: "B", minutes: 3, speakerIndex: 0 },
  { id: "pf-grand-crossfire", label: "Grand Crossfire", shortLabel: "GCF", side: "Both", minutes: 3, speakerIndex: null },
  { id: "pf-pro-final", label: "Pro Final Focus", shortLabel: "PRO FF", side: "A", minutes: 2, speakerIndex: 1 },
  { id: "pf-con-final", label: "Con Final Focus", shortLabel: "CON FF", side: "B", minutes: 2, speakerIndex: 1 },
];

const LD_SPEECHES: Array<Omit<Speech, "transcript" | "notes" | "status">> = [
  { id: "ld-ac", label: "Affirmative Constructive", shortLabel: "AC", side: "A", minutes: 6, speakerIndex: 0 },
  { id: "ld-cx-1", label: "Negative Cross-Examination", shortLabel: "CX", side: "Both", minutes: 3, speakerIndex: null },
  { id: "ld-nc", label: "Negative Constructive", shortLabel: "NC", side: "B", minutes: 7, speakerIndex: 0 },
  { id: "ld-cx-2", label: "Affirmative Cross-Examination", shortLabel: "CX", side: "Both", minutes: 3, speakerIndex: null },
  { id: "ld-1ar", label: "First Affirmative Rebuttal", shortLabel: "1AR", side: "A", minutes: 4, speakerIndex: 0 },
  { id: "ld-nr", label: "Negative Rebuttal", shortLabel: "NR", side: "B", minutes: 6, speakerIndex: 0 },
  { id: "ld-2ar", label: "Second Affirmative Rebuttal", shortLabel: "2AR", side: "A", minutes: 3, speakerIndex: 0 },
];

const SAMPLE_TRANSCRIPTS: Record<string, string> = {
  "pf-pro-constructive":
    "Our first contention is grid reliability. Nuclear generation produces firm, low-carbon power regardless of weather. Federal investment solves the unusually high financing costs that prevent otherwise viable projects from being built. The impact is faster decarbonization without sacrificing reliability during peak demand.",
  "pf-con-constructive":
    "Our contention is opportunity cost. New nuclear projects routinely take longer and cost more than expected. Every public dollar committed to a reactor is unavailable for renewables, transmission, storage, and efficiency that can reduce emissions sooner. Climate action delayed is climate damage locked in.",
  "pf-crossfire-1":
    "Pro asks whether renewables alone can cover multi-day weather events. Con answers that a diversified grid includes transmission and storage. Con asks for the construction timeline. Pro says advanced designs and federal risk sharing shorten deployment, but does not give a specific national average.",
  "pf-pro-rebuttal":
    "Con treats investment as zero-sum but never proves the federal government must cancel renewable spending. Their delay argument compares first-of-a-kind projects to mature technologies. On our case, they do not answer the need for firm clean capacity during prolonged low-wind periods.",
  "pf-con-rebuttal":
    "Pro's reliability claim assumes nuclear is the only firm clean option. They have not quantified how much capacity their investment produces or by when. Even if the funding is additive, scarce labor and transmission capacity still create opportunity costs. Prefer our near-term emissions reductions because climate impacts compound.",
  "pf-pro-summary":
    "The round comes down to whether the transition can remain reliable. Con offers faster resources but no answer for long-duration shortfalls. Our investment is additive and targets the financing barrier. Preserve reliability first because blackouts undermine electrification and public support for decarbonization.",
  "pf-con-summary":
    "Judge this round on time. Pro still has no deployment date, no capacity estimate, and no comparative cost. We give deployable alternatives now. Even if firm power matters, unquantified future reactors do not outweigh measurable near-term reductions.",
};

const SAMPLE_ANALYSIS: Analysis = {
  summary:
    "The central clash is reliability versus speed. Pro says firm nuclear capacity protects decarbonization during renewable shortfalls; Con says slow, costly projects displace faster emissions reductions. The transcript leaves the size of the investment, expected capacity, and comparative timelines underdeveloped.",
  arguments: [
    {
      id: "reliability",
      side: "Pro / Team A",
      claim: "Nuclear investment supplies firm low-carbon power and protects grid reliability.",
      support: "Federal support reduces financing barriers for capital-intensive projects.",
      status: "contested",
      transcriptQuote: "firm, low-carbon power regardless of weather",
    },
    {
      id: "opportunity-cost",
      side: "Con / Team B",
      claim: "Nuclear spending delays faster climate action through cost and opportunity cost.",
      support: "Renewables, transmission, storage, and efficiency can deploy sooner.",
      status: "extended",
      transcriptQuote: "Climate action delayed is climate damage locked in.",
    },
  ],
  responses: [
    {
      side: "Con / Team B",
      target: "Reliability",
      response: "A diversified grid can combine transmission and storage; Pro has not quantified needed nuclear capacity.",
      status: "answered",
    },
    {
      side: "Pro / Team A",
      target: "Opportunity cost",
      response: "The investment can be additive, so Con has not shown renewable spending must fall.",
      status: "partial",
    },
  ],
  votingIssues: [
    {
      title: "Time horizon",
      comparison: "Con has the clearer near-term timeline, while Pro argues that long-term reliability is a prerequisite for durable decarbonization.",
      verify: "Check whether either side supplied a warranted deployment timeline or merely asserted speed.",
    },
    {
      title: "Reliability link",
      comparison: "Pro identifies a specific grid need; Con offers alternatives but the transcript does not show their performance during prolonged renewable shortfalls.",
      verify: "Decide whether the alternatives response was sufficiently warranted in rebuttal and summary.",
    },
  ],
  newArgumentAlerts: [],
  feedback: {
    strengths: ["Both sides collapse toward a clear final comparison.", "Rebuttals directly engage the opposing mechanism."],
    improvements: ["Quantify timelines and capacity.", "Explain evidence methodology when citing project performance."],
  },
  judgeReview: {
    suggestedWinner: "B",
    confidence: "moderate",
    headline: "Con has the clearer comparative path on the available record.",
    roundReview:
      "This is a close reliability-versus-speed debate. Pro identifies a meaningful need for firm clean power, but Con more consistently turns the comparison toward deployment time, cost, and near-term emissions. On the visible transcript, Pro never supplies the timeline or capacity comparison needed to overcome Con's impact framing.",
    winnerReasoning: [
      "Con extends a concrete time-horizon comparison through rebuttal and summary.",
      "Pro's reliability mechanism remains important but under-quantified on deployment date and capacity.",
      "Con explains why near-term emissions reductions should be preferred when climate harms compound.",
    ],
    teamA: {
      strengths: [
        "Identified a specific reliability problem that faster resources still need to solve.",
        "Directly answered the claim that federal investment must be zero-sum.",
      ],
      improvements: [
        "Give a warranted deployment timeline and capacity estimate instead of relying on a general promise of advanced designs.",
        "Compare the scale of long-duration reliability benefits directly against Con's near-term emissions impact.",
      ],
      nextRoundFocus: "Quantify the link: when the investment produces capacity, how much it produces, and why that outweighs faster alternatives.",
    },
    teamB: {
      strengths: [
        "Maintained a consistent time-horizon framework from constructive through summary.",
        "Pressed the missing timeline, capacity, and cost comparisons in Pro's case.",
      ],
      improvements: [
        "Warrant how transmission and storage perform during the prolonged renewable shortfalls Pro identifies.",
        "Clarify whether the opportunity cost is fiscal, labor-based, transmission-based, or all three.",
      ],
      nextRoundFocus: "Strengthen the reliability response so the ballot does not depend only on Pro's missing quantification.",
    },
    caveat: "Suggested winner only. Verify the full final-focus record and your own flow before selecting the winner.",
  },
  source: "sample",
};

function createSpeeches(event: EventType): Speech[] {
  const templates = event === "PF" ? PF_SPEECHES : LD_SPEECHES;
  return templates.map((speech, index) => ({
    ...speech,
    transcript: "",
    notes: "",
    status: index === 0 ? "active" : "upcoming",
  }));
}

function formatTime(seconds: number) {
  const minutes = Math.floor(Math.abs(seconds) / 60);
  const remainder = Math.abs(seconds) % 60;
  return `${seconds < 0 ? "+" : ""}${minutes}:${String(remainder).padStart(2, "0")}`;
}

function pointKey(side: SideKey, index: number) {
  return `${side}-${index}`;
}

function defaultPoints(event: EventType): Record<string, number> {
  return event === "PF"
    ? { "A-0": 28.3, "A-1": 28.1, "B-0": 28.2, "B-1": 28.0 }
    : { "A-0": 28.2, "B-0": 28.1 };
}

function getSpeakerName(setup: RoundSetup, side: SideKey, index: number | null) {
  if (side === "Both" || index === null) return "Multiple speakers";
  return side === "A" ? setup.speakersA[index] : setup.speakersB[index];
}

function getSideName(setup: RoundSetup, side: SideKey) {
  if (side === "Both") return "Both sides";
  return side === "A" ? setup.teamA : setup.teamB;
}

function makeLocalAnalysis(setup: RoundSetup, speeches: Speech[]): Analysis {
  const complete = speeches.filter((speech) => speech.transcript.trim());
  const sideA = complete.filter((speech) => speech.side === "A");
  const sideB = complete.filter((speech) => speech.side === "B");
  const firstSentence = (items: Speech[], fallback: string) => {
    const text = items.map((item) => item.transcript).join(" ");
    return text.split(/(?<=[.!?])\s+/)[0]?.slice(0, 220) || fallback;
  };
  return {
    summary:
      "Local review is active. JudgeFlow organized the available transcript, but an OpenAI key is needed for deeper argument matching.",
    arguments: [
      {
        id: "local-a",
        side: setup.teamA,
        claim: firstSentence(sideA, "No transcribed argument is available yet."),
        support: `${sideA.length} transcribed ${sideA.length === 1 ? "speech" : "speeches"} from this side.`,
        status: "introduced",
        transcriptQuote: firstSentence(sideA, "Add or transcribe this side's speech."),
      },
      {
        id: "local-b",
        side: setup.teamB,
        claim: firstSentence(sideB, "No transcribed argument is available yet."),
        support: `${sideB.length} transcribed ${sideB.length === 1 ? "speech" : "speeches"} from this side.`,
        status: "introduced",
        transcriptQuote: firstSentence(sideB, "Add or transcribe this side's speech."),
      },
    ],
    responses: [],
    votingIssues: [
      {
        title: "Comparative warrant",
        comparison: "Compare which side links its claim to the resolution with the clearest warranted mechanism.",
        verify: "Return to the transcript before treating silence as a concession.",
      },
    ],
    newArgumentAlerts: [],
    feedback: {
      strengths: ["The available transcript preserves a record for post-round verification."],
      improvements: ["Add an OpenAI API key for transcript-backed response matching and tailored feedback."],
    },
    judgeReview: {
      ...EMPTY_JUDGE_REVIEW,
      headline: "A winner recommendation needs deeper comparative analysis.",
      roundReview: `The local review found ${sideA.length} transcribed speeches for ${setup.teamA} and ${sideB.length} for ${setup.teamB}. Configure an OpenAI API key to compare extensions, responses, and impacts without inventing a decision.`,
      teamA: {
        strengths: sideA.length ? ["Placed at least one identifiable position into the transcript."] : [],
        improvements: ["Make the final extension identify the claim, warrant, impact, and response to the opposing side."],
        nextRoundFocus: "State exactly why your surviving argument outweighs the opponent's best response.",
      },
      teamB: {
        strengths: sideB.length ? ["Placed at least one identifiable position into the transcript."] : [],
        improvements: ["Make the final extension identify the claim, warrant, impact, and response to the opposing side."],
        nextRoundFocus: "State exactly why your surviving argument outweighs the opponent's best response.",
      },
    },
    source: "local",
  };
}

function buildLocalBallot(
  setup: RoundSetup,
  winner: SideKey,
  issues: VotingIssue[],
): BallotDraft {
  const side = getSideName(setup, winner);
  const issue = issues[0];
  const speakers = [
    ...setup.speakersA.map((speaker) => ({ speaker, side: setup.teamA })),
    ...setup.speakersB.map((speaker) => ({ speaker, side: setup.teamB })),
  ];
  return {
    rfd: `I vote for ${side}. ${issue ? `The decisive issue is ${issue.title.toLowerCase()}. ${issue.comparison}` : "The deciding factor was the comparative strength of the arguments extended through the final speeches."} I evaluated the arguments presented in the round and used speaking quality only for speaker points.`,
    oralDisclosure: `My decision is for ${side}. The main issue was ${issue?.title.toLowerCase() || "comparative argument quality"}. I will explain the decisive comparison first, then offer one strength and one area for improvement for each side.`,
    feedback: speakers.map(({ speaker, side: speakerSide }) => ({
      speaker,
      strengths: `${speakerSide}: maintained a clear position and contributed to the round's central clash.`,
      improvements: "Make the final comparison more explicit and tie each extension back to a warranted impact.",
    })),
    source: "local",
  };
}

export default function JudgeWorkspace() {
  const [setup, setSetup] = useState<RoundSetup>(DEFAULT_SETUP);
  const [stage, setStage] = useState<Stage>("setup");
  const [speeches, setSpeeches] = useState<Speech[]>(() => createSpeeches("PF"));
  const [activeSpeechId, setActiveSpeechId] = useState("pf-pro-constructive");
  const [analysis, setAnalysis] = useState<Analysis>(EMPTY_ANALYSIS);
  const [winner, setWinner] = useState<SideKey | "">("");
  const [selectedIssues, setSelectedIssues] = useState<number[]>([]);
  const [points, setPoints] = useState<Record<string, number>>(() => defaultPoints("PF"));
  const [ballot, setBallot] = useState<BallotDraft | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [listenStatus, setListenStatus] = useState<"idle" | "connecting" | "listening" | "error">("idle");
  const [listenMessage, setListenMessage] = useState("Audio is off");
  const [transcriptionEngine, setTranscriptionEngine] = useState<TranscriptionEngine | null>(null);
  const [livePartial, setLivePartial] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [toast, setToast] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const browserRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const shouldListenRef = useRef(false);
  const engineRef = useRef<TranscriptionEngine | null>(null);
  const fallbackStartingRef = useRef(false);
  const demoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeSpeechRef = useRef(activeSpeechId);
  const livePartialRef = useRef("");
  const transcriptTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const activeSpeech = speeches.find((speech) => speech.id === activeSpeechId) || speeches[0];
  const completedCount = speeches.filter((speech) => speech.status === "complete").length;
  const remaining = activeSpeech ? activeSpeech.minutes * 60 - elapsed : 0;
  const speakerRows = useMemo(() => {
    const a = setup.speakersA.map((name, index) => ({ key: pointKey("A", index), name, side: setup.teamA }));
    const b = setup.speakersB.map((name, index) => ({ key: pointKey("B", index), name, side: setup.teamB }));
    return [...a, ...b];
  }, [setup]);
  const pointValues = speakerRows.map((row) => points[row.key]);
  const hasPointTie = pointValues.some((point, index) => pointValues.indexOf(point) !== index);
  const pointRangeValid = pointValues.every(
    (point) => Number.isFinite(point) && point >= 27 && point <= 29 && Math.round(point * 10) === point * 10,
  );
  const selectedVotingIssues = selectedIssues
    .map((index) => analysis.votingIssues[index])
    .filter(Boolean);
  const judgeReview = analysis.judgeReview || EMPTY_JUDGE_REVIEW;
  const suggestedSide = judgeReview.suggestedWinner === "A" || judgeReview.suggestedWinner === "B"
    ? judgeReview.suggestedWinner
    : null;
  const browserSpeechAvailable = hydrated && Boolean(getBrowserSpeechConstructor());

  useEffect(() => {
    activeSpeechRef.current = activeSpeechId;
  }, [activeSpeechId]);

  useEffect(() => {
    if (listenStatus !== "listening") return;
    const transcriptField = transcriptTextareaRef.current;
    if (!transcriptField) return;
    transcriptField.scrollTop = transcriptField.scrollHeight;
  }, [activeSpeechId, activeSpeech.transcript, livePartial, listenStatus]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as SavedState;
          setSetup(parsed.setup);
          setStage(parsed.stage);
          setSpeeches(parsed.speeches);
          setActiveSpeechId(parsed.activeSpeechId);
          setAnalysis({
            ...parsed.analysis,
            judgeReview: parsed.analysis.judgeReview || EMPTY_JUDGE_REVIEW,
          });
          setWinner(parsed.winner);
          setSelectedIssues(parsed.selectedIssues);
          setPoints(parsed.points);
          setBallot(parsed.ballot);
        }
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      } finally {
        setHydrated(true);
      }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const state: SavedState = {
      setup,
      stage,
      speeches,
      activeSpeechId,
      analysis,
      winner,
      selectedIssues,
      points,
      ballot,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [hydrated, setup, stage, speeches, activeSpeechId, analysis, winner, selectedIssues, points, ballot]);

  useEffect(() => {
    if (!timerRunning) return;
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [timerRunning]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    return () => {
      if (demoIntervalRef.current) clearInterval(demoIntervalRef.current);
      shouldListenRef.current = false;
      browserRecognitionRef.current?.abort();
      channelRef.current?.close();
      peerRef.current?.close();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function updateSetup<K extends keyof RoundSetup>(key: K, value: RoundSetup[K]) {
    setSetup((current) => ({ ...current, [key]: value }));
  }

  function switchEvent(event: EventType) {
    const nextSetup: RoundSetup = event === "PF"
      ? { ...setup, event, teamA: "Team A", teamB: "Team B", speakersA: ["Pro 1", "Pro 2"], speakersB: ["Con 1", "Con 2"] }
      : { ...setup, event, teamA: "Affirmative", teamB: "Negative", speakersA: ["Affirmative speaker"], speakersB: ["Negative speaker"] };
    setSetup(nextSetup);
    const nextSpeeches = createSpeeches(event);
    setSpeeches(nextSpeeches);
    setActiveSpeechId(nextSpeeches[0].id);
    setPoints(defaultPoints(event));
    setWinner("");
    setBallot(null);
    setAnalysis(EMPTY_ANALYSIS);
  }

  function startRound() {
    if (!setup.resolution.trim()) {
      setToast("Add the resolution before starting.");
      return;
    }
    if (!setup.authorized || !setup.judgeOwnsDecision) {
      setToast("Confirm both safeguards before starting.");
      return;
    }
    const nextSpeeches = createSpeeches(setup.event);
    setSpeeches(nextSpeeches);
    setActiveSpeechId(nextSpeeches[0].id);
    setPoints(defaultPoints(setup.event));
    setAnalysis(EMPTY_ANALYSIS);
    setWinner("");
    setSelectedIssues([]);
    setBallot(null);
    setStage("round");
  }

  function loadSampleRound() {
    const sampleSpeeches = createSpeeches("PF").map((speech, index) => ({
      ...speech,
      transcript: SAMPLE_TRANSCRIPTS[speech.id] || "",
      notes:
        speech.side === "Both"
          ? "Track concessions carefully; speaker attribution may need manual correction."
          : index < 7
            ? "Check the warrant and whether this is extended later."
            : "",
      status: index < 7 ? "complete" as const : index === 7 ? "active" as const : "upcoming" as const,
    }));
    setSetup(DEMO_SETUP);
    setSpeeches(sampleSpeeches);
    setActiveSpeechId("pf-con-summary");
    setAnalysis(SAMPLE_ANALYSIS);
    setPoints(defaultPoints("PF"));
    setWinner("");
    setSelectedIssues([]);
    setBallot(null);
    setElapsed(0);
    setStage("round");
    setToast("Sample round loaded — nothing will be recorded.");
  }

  function selectSpeech(id: string) {
    if (livePartial.trim()) commitPartial();
    setSpeeches((current) =>
      current.map((speech) => ({
        ...speech,
        status: speech.id === id ? "active" : speech.status === "active" ? "upcoming" : speech.status,
      })),
    );
    setActiveSpeechId(id);
    setElapsed(0);
    setTimerRunning(false);
    replaceLivePartial("");
  }

  function updateSpeech(id: string, patch: Partial<Speech>) {
    setSpeeches((current) => current.map((speech) => (speech.id === id ? { ...speech, ...patch } : speech)));
  }

  function appendTranscript(id: string, text: string) {
    if (!text.trim()) return;
    setSpeeches((current) =>
      current.map((speech) =>
        speech.id === id
          ? { ...speech, transcript: `${speech.transcript}${speech.transcript.trim() ? " " : ""}${text.trim()}` }
          : speech,
      ),
    );
  }

  function replaceLivePartial(text: string) {
    livePartialRef.current = text;
    setLivePartial(text);
  }

  function appendLivePartial(text: string) {
    setLivePartial((current) => {
      const next = current + text;
      livePartialRef.current = next;
      return next;
    });
  }

  function commitPartial() {
    const partial = livePartialRef.current;
    if (partial.trim()) appendTranscript(activeSpeechRef.current, partial);
    replaceLivePartial("");
  }

  function completeSpeech() {
    commitPartial();
    if (channelRef.current?.readyState === "open") {
      channelRef.current.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    }
    const index = speeches.findIndex((speech) => speech.id === activeSpeechId);
    const next = speeches[index + 1];
    setSpeeches((current) =>
      current.map((speech) => {
        if (speech.id === activeSpeechId) return { ...speech, status: "complete" };
        if (next && speech.id === next.id) return { ...speech, status: "active" };
        return speech;
      }),
    );
    setTimerRunning(false);
    setElapsed(0);
    if (next) {
      setActiveSpeechId(next.id);
      setToast(`${activeSpeech.label} saved. ${next.label} is ready.`);
    } else {
      setToast("Round complete. Review the decision workspace.");
    }
  }

  async function startListening() {
    if (!setup.authorized) {
      setToast("Confirm authorization before capturing audio.");
      return;
    }
    shouldListenRef.current = true;
    fallbackStartingRef.current = false;
    setListenStatus("connecting");
    setListenMessage("Selecting the best transcription service…");
    const BrowserSpeech = getBrowserSpeechConstructor();
    if (setup.audioSource === "microphone" && BrowserSpeech) {
      await startBrowserListening(BrowserSpeech);
      return;
    }
    await startOpenAIListening(
      setup.audioSource === "tab"
        ? "Shared-tab audio uses OpenAI transcription."
        : "Browser speech is unavailable; using OpenAI.",
    );
  }

  async function startBrowserListening(BrowserSpeech: BrowserSpeechConstructor) {
    const recognition = new BrowserSpeech();
    let localProcessing = false;
    if (BrowserSpeech.available && "processLocally" in recognition) {
      try {
        const availability = await BrowserSpeech.available({ langs: ["en-US"], processLocally: true, quality: "conversation" });
        if (availability === "available") {
          recognition.processLocally = true;
          localProcessing = true;
        }
      } catch {
        // Older Chrome builds can expose SpeechRecognition without the on-device availability API.
      }
    }
    if (!shouldListenRef.current) return;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;
    browserRecognitionRef.current = recognition;
    engineRef.current = "browser";
    setTranscriptionEngine("browser");

    recognition.onstart = () => {
      if (!shouldListenRef.current) {
        recognition.abort();
        return;
      }
      setListenStatus("listening");
      setListenMessage(localProcessing ? "Chrome on-device speech · microphone" : "Chrome browser speech · microphone");
    };
    recognition.onresult = (event) => {
      if (!shouldListenRef.current || engineRef.current !== "browser") return;
      let finalText = "";
      let interimText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript || "";
        if (result?.isFinal) finalText += transcript;
        else interimText += transcript;
      }
      if (finalText.trim()) appendTranscript(activeSpeechRef.current, finalText);
      replaceLivePartial(interimText);
    };
    recognition.onerror = (event) => {
      if (event.error === "aborted" && !shouldListenRef.current) return;
      if (event.error === "no-speech") {
        setListenMessage("Browser speech is waiting for someone to speak");
        return;
      }
      if (event.error === "not-allowed" || event.error === "audio-capture") {
        shouldListenRef.current = false;
        engineRef.current = null;
        browserRecognitionRef.current = null;
        setTranscriptionEngine(null);
        setListenStatus("error");
        setListenMessage(event.error === "not-allowed" ? "Microphone permission was denied." : "Chrome could not access the microphone.");
        return;
      }
      void fallbackToOpenAI(`Browser speech reported ${event.error}.`);
    };
    recognition.onend = () => {
      if (!shouldListenRef.current || engineRef.current !== "browser" || fallbackStartingRef.current) return;
      try {
        recognition.start();
      } catch {
        window.setTimeout(() => {
          if (shouldListenRef.current && engineRef.current === "browser") {
            try {
              recognition.start();
            } catch {
              void fallbackToOpenAI("Browser speech stopped unexpectedly.");
            }
          }
        }, 300);
      }
    };

    try {
      recognition.start();
    } catch {
      void fallbackToOpenAI("Browser speech could not start.");
    }
  }

  async function fallbackToOpenAI(reason: string) {
    if (fallbackStartingRef.current || !shouldListenRef.current) return;
    fallbackStartingRef.current = true;
    commitPartial();
    browserRecognitionRef.current?.abort();
    browserRecognitionRef.current = null;
    await startOpenAIListening(`${reason} Switching to OpenAI…`);
    fallbackStartingRef.current = false;
  }

  async function startOpenAIListening(reason?: string) {
    engineRef.current = "openai";
    setTranscriptionEngine("openai");
    setListenStatus("connecting");
    setListenMessage(reason || "Connecting to OpenAI transcription…");
    try {
      const stream = setup.audioSource === "tab"
        ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
        : await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!shouldListenRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("No audio track was shared. Choose a tab and enable Share tab audio.");
      }

      const tokenResponse = await fetch("/api/realtime-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: setup.audioSource, event: setup.event, resolution: setup.resolution }),
      });
      const tokenData = await tokenResponse.json() as { value?: string; error?: string };
      if (!tokenResponse.ok || !tokenData.value) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error(tokenData.error || "Live transcription is not configured.");
      }
      if (!shouldListenRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const peer = new RTCPeerConnection();
      const channel = peer.createDataChannel("oai-events");
      peer.addTrack(audioTrack, stream);
      peerRef.current = peer;
      channelRef.current = channel;
      channel.addEventListener("message", (message) => {
        const event = JSON.parse(message.data) as { type: string; delta?: string; transcript?: string; error?: { message?: string } };
        if (event.type === "conversation.item.input_audio_transcription.delta" && event.delta) {
          appendLivePartial(event.delta);
        }
        if (event.type === "conversation.item.input_audio_transcription.completed" && event.transcript) {
          appendTranscript(activeSpeechRef.current, event.transcript);
          replaceLivePartial("");
        }
        if (event.type === "error") {
          const message = event.error?.message || "The transcription session reported an error.";
          stopListening(false);
          setListenStatus("error");
          setListenMessage(message);
        }
      });
      channel.addEventListener("open", () => {
        if (!shouldListenRef.current) {
          stopListening();
          return;
        }
        setListenStatus("listening");
        setListenMessage(setup.audioSource === "tab" ? "OpenAI · shared tab audio" : "OpenAI fallback · microphone");
      });
      peer.addEventListener("connectionstatechange", () => {
        if (["failed", "disconnected"].includes(peer.connectionState) && shouldListenRef.current) {
          stopListening(false);
          setListenStatus("error");
          setListenMessage("Audio connection lost");
        }
      });

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const answerResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${tokenData.value}`,
          "Content-Type": "application/sdp",
        },
      });
      if (!answerResponse.ok) throw new Error("OpenAI could not start the audio session.");
      const answerSdp = await answerResponse.text();
      if (!shouldListenRef.current) {
        stopListening(false);
        return;
      }
      await peer.setRemoteDescription({ type: "answer", sdp: answerSdp });

    } catch (error) {
      const shouldReportError = shouldListenRef.current;
      shouldListenRef.current = false;
      channelRef.current?.close();
      peerRef.current?.close();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      channelRef.current = null;
      peerRef.current = null;
      streamRef.current = null;
      engineRef.current = null;
      setTranscriptionEngine(null);
      if (shouldReportError) {
        setListenStatus("error");
        setListenMessage(error instanceof Error ? error.message : "Could not start audio capture.");
      }
    }
  }

  function startDemoListening() {
    stopListening(false);
    const script =
      "The key comparison is whether near-term deployment outweighs long-term grid reliability. Our opponents have not quantified the duration of the shortfall or explained why their alternative solves during prolonged low-wind periods.";
    const words = script.split(" ");
    let index = 0;
    shouldListenRef.current = false;
    engineRef.current = "demo";
    setTranscriptionEngine("demo");
    replaceLivePartial("");
    setListenStatus("listening");
    setListenMessage("Demo audio — simulated transcript");
    demoIntervalRef.current = setInterval(() => {
      if (index >= words.length) {
        if (demoIntervalRef.current) clearInterval(demoIntervalRef.current);
        demoIntervalRef.current = null;
        return;
      }
      const word = words[index++];
      const separator = livePartialRef.current ? " " : "";
      appendLivePartial(`${separator}${word}`);
    }, 180);
  }

  function stopListening(updateStatus = true) {
    shouldListenRef.current = false;
    fallbackStartingRef.current = false;
    if (livePartialRef.current.trim()) commitPartial();
    if (demoIntervalRef.current) clearInterval(demoIntervalRef.current);
    demoIntervalRef.current = null;
    browserRecognitionRef.current?.abort();
    browserRecognitionRef.current = null;
    channelRef.current?.close();
    peerRef.current?.close();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    channelRef.current = null;
    peerRef.current = null;
    streamRef.current = null;
    engineRef.current = null;
    setTranscriptionEngine(null);
    if (updateStatus) {
      setListenStatus("idle");
      setListenMessage("Audio is off");
    }
  }

  async function analyzeRound() {
    commitPartial();
    setAnalyzing(true);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setup, speeches }),
      });
      const data = await response.json() as Analysis & { error?: string };
      if (!response.ok) throw new Error(data.error || "Analysis failed.");
      setAnalysis(data);
      setSelectedIssues([]);
      setToast(data.source === "openai" ? "Argument flow updated from the transcript." : "Local review updated. Add an API key for deeper analysis.");
    } catch (error) {
      setAnalysis(makeLocalAnalysis(setup, speeches));
      setToast(error instanceof Error ? error.message : "Using local review instead.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function generateBallot() {
    if (!winner) {
      setToast("Choose the winning side first.");
      return;
    }
    if (!pointRangeValid || hasPointTie) {
      setToast("Speaker points must be 27–29 in 0.1 increments with no ties.");
      return;
    }
    setDrafting(true);
    try {
      const response = await fetch("/api/ballot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setup, speeches, analysis, winner, selectedIssues: selectedVotingIssues, points }),
      });
      const data = await response.json() as BallotDraft & { error?: string };
      if (!response.ok) throw new Error(data.error || "Ballot drafting failed.");
      setBallot(data);
      setStage("ballot");
      setToast(data.source === "openai" ? "Ballot draft ready for your review." : "Local ballot draft ready for your review.");
    } catch {
      setBallot(buildLocalBallot(setup, winner, selectedVotingIssues));
      setStage("ballot");
      setToast("Local ballot draft ready for your review.");
    } finally {
      setDrafting(false);
    }
  }

  function changePoint(key: string, raw: string) {
    const value = Number(raw);
    setPoints((current) => ({ ...current, [key]: value }));
  }

  function copyText(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => setToast(`${label} copied.`));
  }

  function exportRound() {
    const payload = JSON.stringify({ setup, speeches, analysis, winner, selectedIssues, points, ballot }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `judgeflow-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setToast("Private round export downloaded.");
  }

  function resetRound() {
    if (!window.confirm("Delete this round from this browser? This cannot be undone unless you exported it.")) return;
    stopListening();
    window.localStorage.removeItem(STORAGE_KEY);
    setSetup(DEFAULT_SETUP);
    setStage("setup");
    const next = createSpeeches("PF");
    setSpeeches(next);
    setActiveSpeechId(next[0].id);
    setAnalysis(EMPTY_ANALYSIS);
    setWinner("");
    setSelectedIssues([]);
    setPoints(defaultPoints("PF"));
    setBallot(null);
    setToast("Round deleted from this browser.");
  }

  const tabs: Array<{ id: Stage; label: string; enabled: boolean }> = [
    { id: "setup", label: "1 · Setup", enabled: true },
    { id: "round", label: "2 · Round", enabled: speeches.length > 0 && (stage !== "setup" || setup.authorized) },
    { id: "decision", label: "3 · Decision", enabled: stage !== "setup" },
    { id: "ballot", label: "4 · Ballot", enabled: Boolean(ballot) },
  ];

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">JF</div>
          <div>
            <strong>JudgeFlow</strong>
            <span>Argument-first debate judging</span>
          </div>
        </div>
        <div className="privacy-chip"><span /> Local-first · Judge decides</div>
        <div className="top-actions">
          <button className="text-button" onClick={exportRound} disabled={stage === "setup"}>Export</button>
          <button className="text-button danger-text" onClick={resetRound}>Delete round</button>
        </div>
      </header>

      <nav className="stage-nav" aria-label="Round workflow">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={stage === tab.id ? "active" : ""}
            disabled={!tab.enabled}
            onClick={() => tab.enabled && setStage(tab.id)}
          >
            {tab.label}
          </button>
        ))}
        <div className="save-state">Saved on this device</div>
      </nav>

      {stage === "setup" && (
        <section className="setup-page">
          <div className="setup-intro">
            <span className="eyebrow">Private round workspace</span>
            <h1>Hear the debate.<br /><em>See the decision.</em></h1>
            <p>
              Capture a live transcript, preserve the argument flow, and turn your own decision into substantial, balanced ballot feedback.
            </p>
            <div className="principles">
              <div><strong>01</strong><span>No raw audio saved by JudgeFlow</span></div>
              <div><strong>02</strong><span>Every AI observation points back to the transcript</span></div>
              <div><strong>03</strong><span>You choose the winner and submit the ballot</span></div>
            </div>
          </div>

          <div className="setup-card">
            <div className="card-heading">
              <div><span className="step-kicker">ROUND SETUP</span><h2>Start a new ballot</h2></div>
              <span className="required-note">* required</span>
            </div>

            <fieldset className="event-toggle">
              <legend>Event</legend>
              <button className={setup.event === "PF" ? "selected" : ""} onClick={() => switchEvent("PF")}>
                <strong>Public Forum</strong><span>2 vs 2 · PF</span>
              </button>
              <button className={setup.event === "LD" ? "selected" : ""} onClick={() => switchEvent("LD")}>
                <strong>Lincoln-Douglas</strong><span>1 vs 1 · LD</span>
              </button>
            </fieldset>

            <label className="field-label">
              Tournament
              <input value={setup.tournament} onChange={(event) => updateSetup("tournament", event.target.value)} />
            </label>
            <label className="field-label">
              Resolution <span>*</span>
              <textarea
                rows={3}
                placeholder="Resolved: …"
                value={setup.resolution}
                onChange={(event) => updateSetup("resolution", event.target.value)}
              />
            </label>

            <div className="two-fields">
              <label className="field-label">
                {setup.event === "PF" ? "Pro label" : "Aff label"}
                <input value={setup.teamA} onChange={(event) => updateSetup("teamA", event.target.value)} />
              </label>
              <label className="field-label">
                {setup.event === "PF" ? "Con label" : "Neg label"}
                <input value={setup.teamB} onChange={(event) => updateSetup("teamB", event.target.value)} />
              </label>
            </div>

            <fieldset className="audio-choice">
              <legend>Audio source</legend>
              <label className={setup.audioSource === "tab" ? "selected" : ""}>
                <input type="radio" name="audio" checked={setup.audioSource === "tab"} onChange={() => updateSetup("audioSource", "tab")} />
                <span className="radio-dot" /><span><strong>Shared debate tab</strong><small>OpenAI captures the shared tab audio</small></span>
              </label>
              <label className={setup.audioSource === "microphone" ? "selected" : ""}>
                <input type="radio" name="audio" checked={setup.audioSource === "microphone"} onChange={() => updateSetup("audioSource", "microphone")} />
                <span className="radio-dot" /><span><strong>Room microphone</strong><small>{browserSpeechAvailable ? "Chrome speech first · OpenAI fallback" : "OpenAI fallback on this browser"}</small></span>
              </label>
            </fieldset>
            <p className="engine-note"><strong>Automatic transcription:</strong> JudgeFlow prefers Chrome speech for microphone capture when available, including on-device recognition when installed. Shared-tab audio and browser-service failures use OpenAI.</p>

            <div className="safeguard-box">
              <label>
                <input type="checkbox" checked={setup.authorized} onChange={(event) => updateSetup("authorized", event.target.checked)} />
                <span>I have tournament authorization and any required participant notice to process this round&apos;s audio.</span>
              </label>
              <label>
                <input type="checkbox" checked={setup.judgeOwnsDecision} onChange={(event) => updateSetup("judgeOwnsDecision", event.target.checked)} />
                <span>I will personally evaluate the round, choose the winner, assign points, and submit the ballot.</span>
              </label>
            </div>

            <div className="setup-actions">
              <button className="primary-button" onClick={startRound}>Start live round <span>→</span></button>
              <button className="secondary-button" onClick={loadSampleRound}>Explore sample round</button>
            </div>
            <p className="microcopy">Use anonymous team labels. Your setup and notes stay in this browser unless you export them.</p>
          </div>
        </section>
      )}

      {stage === "round" && activeSpeech && (
        <section className="round-page">
          <aside className="speech-rail">
            <div className="rail-heading">
              <span className="eyebrow">{setup.event} · SPEECH ORDER</span>
              <strong>{completedCount}/{speeches.length} complete</strong>
            </div>
            <div className="progress-track"><span style={{ width: `${(completedCount / speeches.length) * 100}%` }} /></div>
            <div className="speech-list">
              {speeches.map((speech, index) => (
                <button
                  key={speech.id}
                  className={`speech-item ${speech.id === activeSpeechId ? "active" : ""} ${speech.status}`}
                  onClick={() => selectSpeech(speech.id)}
                >
                  <span className="speech-index">{speech.status === "complete" ? "✓" : String(index + 1).padStart(2, "0")}</span>
                  <span className="speech-name"><strong>{speech.shortLabel}</strong><small>{speech.label}</small></span>
                  <span className="speech-time">{speech.minutes}:00</span>
                </button>
              ))}
            </div>
            <div className="rail-note">
              <span aria-hidden="true">◉</span>
              <p><strong>Speaker labels are manual.</strong> Live transcription does not identify speakers. Crossfire may need corrections.</p>
            </div>
          </aside>

          <div className="round-main">
            <div className="round-context">
              <div>
                <span className="eyebrow">{setup.tournament}</span>
                <p>{setup.resolution}</p>
              </div>
              <button className="context-edit" onClick={() => setStage("setup")}>Edit setup</button>
            </div>

            <section className="active-speech-card">
              <div className="speech-card-top">
                <div>
                  <span className={`side-pill side-${activeSpeech.side.toLowerCase()}`}>{getSideName(setup, activeSpeech.side)}</span>
                  <h1>{activeSpeech.label}</h1>
                  <p>{getSpeakerName(setup, activeSpeech.side, activeSpeech.speakerIndex)}</p>
                </div>
                <div className={`timer ${remaining < 0 ? "overtime" : ""}`}>
                  <span>{remaining < 0 ? "OVERTIME" : timerRunning ? "RUNNING" : "READY"}</span>
                  <strong>{formatTime(remaining)}</strong>
                  <button onClick={() => setTimerRunning((value) => !value)}>{timerRunning ? "Pause timer" : "Start timer"}</button>
                </div>
              </div>

              <div className="audio-strip">
                <div className={`audio-status ${listenStatus}`}>
                  <span className="status-orb" />
                  <div><strong>{listenStatus === "listening" ? "Transcription on" : listenStatus === "connecting" ? "Connecting" : listenStatus === "error" ? "Audio needs attention" : "Transcription off"}</strong><small>{listenMessage}</small></div>
                </div>
                {transcriptionEngine && <span className={`engine-badge engine-${transcriptionEngine}`}>{transcriptionEngine === "browser" ? "Chrome speech" : transcriptionEngine === "openai" ? "OpenAI fallback" : "Simulation"}</span>}
                <div className="waveform" aria-hidden="true">
                  {Array.from({ length: 18 }, (_, index) => <i key={index} style={{ height: listenStatus === "listening" ? `${8 + ((index * 13) % 24)}px` : "5px" }} />)}
                </div>
                {listenStatus === "listening" || listenStatus === "connecting" ? (
                  <button className="stop-button" onClick={() => stopListening()}>Stop audio</button>
                ) : (
                  <button className="listen-button" onClick={startListening}>Start listening</button>
                )}
                <button className="demo-button" onClick={startDemoListening}>Simulate</button>
              </div>

              <div className="editor-grid">
                <label>
                  <span>LIVE TRANSCRIPT <small>{listenStatus === "listening" ? "auto-following" : "editable"}</small></span>
                  <textarea
                    ref={transcriptTextareaRef}
                    value={`${activeSpeech.transcript}${livePartial ? `${activeSpeech.transcript ? " " : ""}${livePartial}` : ""}`}
                    onChange={(event) => {
                      replaceLivePartial("");
                      updateSpeech(activeSpeech.id, { transcript: event.target.value });
                    }}
                    placeholder="Start listening, simulate a transcript, or type notes from the speech here…"
                  />
                </label>
                <label>
                  <span>JUDGE NOTES <small>private</small></span>
                  <textarea
                    value={activeSpeech.notes}
                    onChange={(event) => updateSpeech(activeSpeech.id, { notes: event.target.value })}
                    placeholder="Warrants, evidence quality, delivery, crossfire conduct…"
                  />
                </label>
              </div>

              <div className="speech-actions">
                <button className="secondary-button" onClick={analyzeRound} disabled={analyzing}>
                  {analyzing ? "Organizing arguments…" : "Update argument flow"}
                </button>
                <button className="primary-button" onClick={completeSpeech}>Complete speech <span>→</span></button>
              </div>
            </section>
          </div>

          <aside className="flow-panel">
            <div className="flow-heading">
              <div><span className="eyebrow">ARGUMENT FLOW</span><h2>What matters</h2></div>
              <span className={`source-badge source-${analysis.source}`}>{analysis.source === "openai" ? "AI organized" : analysis.source === "sample" ? "Sample" : "Local review"}</span>
            </div>
            <p className="flow-summary">{analysis.summary}</p>

            <div className="flow-section">
              <div className="flow-section-title"><span>Claims</span><small>{analysis.arguments.length}</small></div>
              {analysis.arguments.length === 0 ? (
                <div className="empty-flow"><span>↗</span><p>Complete a speech and update the flow to see transcript-backed claims.</p></div>
              ) : analysis.arguments.map((item) => (
                <article className="argument-card" key={item.id}>
                  <div><span className="argument-side">{item.side}</span><span className={`argument-status status-${item.status}`}>{item.status.replaceAll("_", " ")}</span></div>
                  <h3>{item.claim}</h3>
                  <p>{item.support}</p>
                  <blockquote>“{item.transcriptQuote}”</blockquote>
                </article>
              ))}
            </div>

            {analysis.responses.length > 0 && (
              <div className="flow-section">
                <div className="flow-section-title"><span>Responses</span><small>{analysis.responses.length}</small></div>
                {analysis.responses.map((item, index) => (
                  <article className="response-card" key={`${item.target}-${index}`}>
                    <strong>{item.side} → {item.target}</strong>
                    <p>{item.response}</p>
                    <span>{item.status.replaceAll("_", " ")}</span>
                  </article>
                ))}
              </div>
            )}

            <button className="decision-link" onClick={() => setStage("decision")}>Open decision workspace <span>→</span></button>
          </aside>
        </section>
      )}

      {stage === "decision" && (
        <section className="decision-page">
          <div className="page-title-row">
            <div><span className="eyebrow">JUDGE REVIEW</span><h1>Review the round. Make your call.</h1><p>JudgeFlow compares the arguments, recommends a result, and coaches both teams. You make the final decision.</p></div>
            <button className="secondary-button" onClick={analyzeRound} disabled={analyzing}>{analyzing ? "Reviewing…" : "Refresh analysis"}</button>
          </div>

          <div className="decision-grid">
            <div className="comparison-column side-a-column">
              <div className="comparison-header"><span>A</span><div><small>{setup.event === "PF" ? "PRO" : "AFF"}</small><h2>{setup.teamA}</h2></div></div>
              {analysis.arguments.filter((item) => item.side.toLowerCase().includes(setup.teamA.toLowerCase()) || item.side.toLowerCase().includes(setup.event === "PF" ? "pro" : "aff")).map((item) => (
                <article key={item.id}><span>{item.status.replaceAll("_", " ")}</span><h3>{item.claim}</h3><p>{item.support}</p><blockquote>“{item.transcriptQuote}”</blockquote></article>
              ))}
              {!analysis.arguments.some((item) => item.side.toLowerCase().includes(setup.teamA.toLowerCase()) || item.side.toLowerCase().includes(setup.event === "PF" ? "pro" : "aff")) && <p className="empty-side">No organized claims for this side yet.</p>}
            </div>

            <div className="issue-column">
              <div className="issue-intro"><span className="eyebrow">CANDIDATE VOTING ISSUES</span><p>Select the issues that actually decide your ballot.</p></div>
              {analysis.votingIssues.map((issue, index) => (
                <label className={`issue-card ${selectedIssues.includes(index) ? "selected" : ""}`} key={issue.title}>
                  <input
                    type="checkbox"
                    checked={selectedIssues.includes(index)}
                    onChange={() => setSelectedIssues((current) => current.includes(index) ? current.filter((value) => value !== index) : [...current, index])}
                  />
                  <span className="issue-number">{String(index + 1).padStart(2, "0")}</span>
                  <div><h3>{issue.title}</h3><p>{issue.comparison}</p><small><strong>VERIFY:</strong> {issue.verify}</small></div>
                </label>
              ))}
              {analysis.votingIssues.length === 0 && <div className="empty-issues">Update the argument flow to generate neutral comparison questions.</div>}
              <div className="late-alerts">
                <strong>Late-argument check</strong>
                {analysis.newArgumentAlerts.length ? analysis.newArgumentAlerts.map((alert) => <p key={alert}>⚑ {alert}</p>) : <p>No potential late arguments were flagged. Verify against your own flow.</p>}
              </div>
            </div>

            <div className="comparison-column side-b-column">
              <div className="comparison-header"><span>B</span><div><small>{setup.event === "PF" ? "CON" : "NEG"}</small><h2>{setup.teamB}</h2></div></div>
              {analysis.arguments.filter((item) => item.side.toLowerCase().includes(setup.teamB.toLowerCase()) || item.side.toLowerCase().includes(setup.event === "PF" ? "con" : "neg")).map((item) => (
                <article key={item.id}><span>{item.status.replaceAll("_", " ")}</span><h3>{item.claim}</h3><p>{item.support}</p><blockquote>“{item.transcriptQuote}”</blockquote></article>
              ))}
              {!analysis.arguments.some((item) => item.side.toLowerCase().includes(setup.teamB.toLowerCase()) || item.side.toLowerCase().includes(setup.event === "PF" ? "con" : "neg")) && <p className="empty-side">No organized claims for this side yet.</p>}
            </div>
          </div>

          <section className="judge-review" aria-labelledby="judge-review-title">
            <div className="review-heading">
              <div>
                <span className="eyebrow">ADVISORY JUDGE REVIEW</span>
                <h2 id="judge-review-title">{judgeReview.headline}</h2>
                <p>{judgeReview.roundReview}</p>
              </div>
              <div className={`recommendation-card ${suggestedSide ? `recommend-${suggestedSide.toLowerCase()}` : "recommend-none"}`}>
                <span>SUGGESTED WINNER</span>
                <strong>{suggestedSide ? getSideName(setup, suggestedSide) : "No recommendation"}</strong>
                <small>{judgeReview.confidence} confidence · advisory only</small>
                {suggestedSide && (
                  <button onClick={() => setWinner(suggestedSide)}>
                    {winner === suggestedSide ? "✓ Selected as my winner" : "Use this as my selection"}
                  </button>
                )}
              </div>
            </div>

            <div className="review-reasons">
              <h3>Why this result is suggested</h3>
              {judgeReview.winnerReasoning.length ? (
                <ol>
                  {judgeReview.winnerReasoning.map((reason) => <li key={reason}>{reason}</li>)}
                </ol>
              ) : (
                <p>The current record does not support a responsible winner recommendation. Review the transcript and select the decisive voting issues yourself.</p>
              )}
            </div>

            <div className="team-review-grid">
              {([
                { key: "A" as const, label: setup.teamA, review: judgeReview.teamA },
                { key: "B" as const, label: setup.teamB, review: judgeReview.teamB },
              ]).map(({ key, label, review }) => (
                <article className={`team-review team-review-${key.toLowerCase()}`} key={key}>
                  <div className="team-review-title"><span>{key}</span><div><small>{key === "A" ? (setup.event === "PF" ? "PRO" : "AFF") : (setup.event === "PF" ? "CON" : "NEG")}</small><h3>{label}</h3></div></div>
                  <div className="review-list strength-list"><strong>What worked</strong>{review.strengths.length ? <ul>{review.strengths.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No verified strength was available from the current transcript.</p>}</div>
                  <div className="review-list improvement-list"><strong>How to improve</strong><ul>{review.improvements.map((item) => <li key={item}>{item}</li>)}</ul></div>
                  <div className="next-round-focus"><span>NEXT-ROUND FOCUS</span><p>{review.nextRoundFocus}</p></div>
                </article>
              ))}
            </div>

            <p className="review-caveat">{judgeReview.caveat}</p>
          </section>

          <section className="decision-card">
            <div className="winner-section">
              <div><span className="eyebrow">YOUR DECISION</span><h2>Which side won the argument?</h2><p>Speaking quality belongs in speaker points, not the win/loss decision.</p></div>
              <div className="winner-buttons">
                <button className={winner === "A" ? "selected side-a" : ""} onClick={() => setWinner("A")}><span>A</span><strong>{setup.teamA}</strong><small>Select as winner</small></button>
                <button className={winner === "B" ? "selected side-b" : ""} onClick={() => setWinner("B")}><span>B</span><strong>{setup.teamB}</strong><small>Select as winner</small></button>
              </div>
            </div>

            <div className="points-section">
              <div className="points-heading"><div><span className="eyebrow">SPEAKER POINTS</span><h2>27.0–29.0 · no ties</h2></div><span className={`validation-pill ${pointRangeValid && !hasPointTie ? "valid" : "invalid"}`}>{pointRangeValid && !hasPointTie ? "✓ Valid" : "Needs attention"}</span></div>
              <div className="point-rows">
                {speakerRows.map((row) => (
                  <label key={row.key}><span><strong>{row.name}</strong><small>{row.side}</small></span><input type="number" min="27" max="29" step="0.1" value={points[row.key] ?? 28} onChange={(event) => changePoint(row.key, event.target.value)} /></label>
                ))}
              </div>
              {hasPointTie && <p className="validation-error">Speaker-point ties are not allowed at this tournament.</p>}
              {!pointRangeValid && <p className="validation-error">Use 27.0–29.0 in 0.1 increments.</p>}
            </div>

            <button className="primary-button generate-ballot" onClick={generateBallot} disabled={drafting || !winner || hasPointTie || !pointRangeValid}>{drafting ? "Drafting your ballot…" : "Draft ballot from my decision"}<span>→</span></button>
          </section>
        </section>
      )}

      {stage === "ballot" && ballot && (
        <section className="ballot-page">
          <div className="page-title-row">
            <div><span className="eyebrow">BALLOT DRAFT</span><h1>Substantial, balanced, and yours.</h1><p>Edit every field, submit and confirm on Tabroom, then disclose if you choose.</p></div>
            <span className={`source-badge source-${ballot.source}`}>{ballot.source === "openai" ? "AI drafted" : "Local draft"}</span>
          </div>

          <div className="ballot-grid">
            <div className="ballot-main">
              <section className="ballot-section">
                <div className="ballot-section-heading"><div><span>01</span><h2>Reason for decision</h2></div><button onClick={() => copyText(ballot.rfd, "Reason for decision")}>Copy</button></div>
                <textarea value={ballot.rfd} onChange={(event) => setBallot({ ...ballot, rfd: event.target.value })} />
                <p className="field-guidance">Explain the decisive arguments and comparison. Avoid basing the decision on delivery.</p>
              </section>

              <section className="ballot-section">
                <div className="ballot-section-heading"><div><span>02</span><h2>Competitor feedback</h2></div><button onClick={() => copyText(ballot.feedback.map((item) => `${item.speaker}\nStrengths: ${item.strengths}\nImprovements: ${item.improvements}`).join("\n\n"), "Feedback")}>Copy all</button></div>
                <div className="feedback-list">
                  {ballot.feedback.map((item, index) => (
                    <article key={`${item.speaker}-${index}`}>
                      <h3>{item.speaker}</h3>
                      <label><span className="strength-label">Strength</span><textarea value={item.strengths} onChange={(event) => setBallot({ ...ballot, feedback: ballot.feedback.map((entry, entryIndex) => entryIndex === index ? { ...entry, strengths: event.target.value } : entry) })} /></label>
                      <label><span className="improve-label">Improve</span><textarea value={item.improvements} onChange={(event) => setBallot({ ...ballot, feedback: ballot.feedback.map((entry, entryIndex) => entryIndex === index ? { ...entry, improvements: event.target.value } : entry) })} /></label>
                    </article>
                  ))}
                </div>
              </section>

              <section className="ballot-section">
                <div className="ballot-section-heading"><div><span>03</span><h2>Optional oral disclosure</h2></div><button onClick={() => copyText(ballot.oralDisclosure, "Disclosure outline")}>Copy</button></div>
                <textarea value={ballot.oralDisclosure} onChange={(event) => setBallot({ ...ballot, oralDisclosure: event.target.value })} />
              </section>
            </div>

            <aside className="submission-card">
              <span className="eyebrow">SUBMISSION CHECK</span>
              <h2>Ready for Tabroom</h2>
              <div className="submission-winner"><small>WINNER</small><strong>{getSideName(setup, winner || "A")}</strong></div>
              <div className="submission-points">
                {speakerRows.map((row) => <div key={row.key}><span>{row.name}</span><strong>{points[row.key]?.toFixed(1)}</strong></div>)}
              </div>
              <ul>
                <li className={ballot.rfd.length > 100 ? "done" : ""}>Substantial reason for decision</li>
                <li className={ballot.feedback.every((item) => item.strengths && item.improvements) ? "done" : ""}>Strength and improvement for each speaker</li>
                <li className={!hasPointTie && pointRangeValid ? "done" : ""}>Valid, untied speaker points</li>
                <li className="manual">Submit and confirm on Tabroom yourself</li>
              </ul>
              <button className="primary-button" onClick={() => copyText(`Reason for decision\n${ballot.rfd}\n\nFeedback\n${ballot.feedback.map((item) => `${item.speaker}: ${item.strengths} Improvement: ${item.improvements}`).join("\n")}`, "Full ballot")}>Copy full ballot <span>→</span></button>
              <p>Submit before giving oral feedback. JudgeFlow never accesses or submits to Tabroom.</p>
            </aside>
          </div>
        </section>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
