export type Student = { id: string; name: string; number: string };
export type ClassRoom = {
  id: string;
  name: string;
  grade: string;
  students: Student[];
  demo?: boolean;
};
export type Question = {
  rubricSpec?: RubricSpec;
  id: string;
  label: string;
  parentId: string | null;
  stem: string;
  max: number | null;
  step: number;
  type: "choice" | "multiple" | "fill" | "solve" | "proof" | "group";
  primary: string;
  skill?: string;
  diagnosticExcluded?: boolean;
  related: string[];
  confirmed: boolean;
  answer: string;
  rubric: string;
  page: number;
  region: { x: number; y: number; w: number; h: number } | null;
};
export type Grade = {
  studentId: string;
  questionId: string;
  score: number | null;
  status: "ungraded" | "draft" | "final" | "absent" | "na";
  note: string;
  tags: string[];
  aiTags?: string[];
  source: "teacher" | "import" | "ai";
  updatedAt?: string;
};
export type Attachment = {
  role?: 'paper' | 'reference' | 'student';
  id: string;
  examId: string;
  studentId: string | null;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
};
export type Exam = {
  answerMaps?: Record<string, AnswerMap>;
  evaluations?: Record<string, any>;
  skillAliases?: Record<string, string>;
  teaching?: any[];
  id: string;
  classId: string;
  className: string;
  name: string;
  date: string;
  students: Student[];
  questions: Question[];
  grades: Record<string, Grade>;
  revision: number;
  demo: boolean;
  attachments: Attachment[];
  plan: string;
  updatedAt: string;
  analysis: Analysis;
};
export type ExamSummary = Pick<
  Exam,
  | "id"
  | "classId"
  | "className"
  | "name"
  | "date"
  | "demo"
  | "revision"
  | "updatedAt"
> & { studentCount: number; questionCount: number };
export type QuestionStat = {
  id: string;
  label: string;
  primary: string;
  confirmedTopic: boolean;
  max: number | null;
  partial?: number;
  pending?: number;
  lostStudentIds?: string[];
  n: number;
  average: number | null;
  rate: number | null;
  full: number;
  zero: number;
  lost: number;
  lostPoints: number;
  annotated: number;
  annotatedLost: number;
  tags: { tag: string; count: number; studentIds: string[] }[];
};
export type TopicStat = {
  name: string;
  questionIds: string[];
  questionLabels: string[];
  count: number;
  max: number;
  n: number;
  rate: number | null;
  students: {
    studentId: string;
    n: number;
    complete: boolean;
    score: number;
    rate: number | null;
  }[];
};
export type Analysis = {
  revision: number;
  max: number | null;
  knownMax?: number;
  topicCoverage?: { confirmed: number; total: number };
  expected: number;
  complete: number;
  absent: number;
  pending: number;
  confirmedCells: number;
  totalCells: number;
  average: number | null;
  median: number | null;
  std: number | null;
  highest: number | null;
  lowest: number | null;
  students: (Student & {
    confirmed: number;
    complete: boolean;
    absent: boolean;
    total: number | null;
    partial: number;
    noteCount: number;
  })[];
  questions: QuestionStat[];
  topics: TopicStat[];
  histogram: { label: string; count: number }[];
  remarks: {
    tag: string;
    source?: "ai";
    students: string[];
    occurrences: number;
    questionIds: string[];
  }[];
  issues: {
    kind: string;
    text: string;
    studentId?: string;
    questionId?: string;
  }[];
};
export type Page =
  | "overview"
  | "classes"
  | "prepare"
  | "grade"
  | "classReport"
  | "student"
  | "reports"
  | "teaching"
  | "assessment"
  | "settings";
export type Settings = {
  fastReview: boolean;
  baseUrl: string;
  visionModel: string;
  gradingModel: string;
  reportModel: string;
  dailyCalls: number;
  maxTokens: number;
  inputPrice: number;
  outputPrice: number;
  currency: "CNY" | "USD";
  hasKey: boolean;
  keyPersistence: "encrypted" | "session";
};
export type Task = {
  progress?: { done: number; total: number };
  id: string;
  examId: string;
  kind: "extract" | "tag" | "grade" | "report" | "classify" | "rubric" | "locate" | "assess";
  status: string;
  createdAt: string;
  finishedAt?: string;
  revision: number;
  model: string;
  attempts: number;
  error: string | null;
  result: any;
  usage?: { input: number; output: number };
  adoptedAt?: string;
  target?: {
    fileId?: string;
    sources?: any[];
    rubricHash?: string;
    mappingHash?: string;
    studentId?: string;
    questionId?: string;
    wholePaper?: boolean;
    sourceFileId?: string;
    pageCount?: number;
  };
};

export type AnswerRegion = {id:string;page:number;box:{x:number;y:number;w:number;h:number};label:string;rotation:0|90|180|270};
export type AnswerMap = {questionId:string;studentId:string|null;fileId:string;regions:AnswerRegion[];warnings:string[];confirmed:boolean;edited:boolean;version:number};
export type RubricCriterion = {id:string;part:string;label:string;points:number|null;skills:string[];expected:string;alternatives:string};
export type RubricSpec = {version:number;confirmed:boolean;origin:'reference'|'generated'|'teacher';answer:string;instructions:string;criteria:RubricCriterion[];warnings:string[];sourceRefs:{fileId:string;pages:number[]}[]};
export type CriterionEvidence = {criterionId:string;status:'demonstrated'|'error'|'not_observed'|'blocked'|'unreadable'|'not_applicable';score:number|null;comment:string;references:{regionId:string;location:string;quote:string}[];accepted:boolean;skillEvidence:{skill:string;status:CriterionEvidence['status'];comment:string}[]};
export type Report = {
  stale?: boolean;
  editedByTeacher?: boolean;
  id: string;
  examId: string;
  studentId: string | null;
  revision: number;
  createdAt: string;
  kind: string;
  teacherText: string | null;
  display: {
    name: string;
    className: string;
    date: string;
    demo: boolean;
    analysis: Analysis;
  };
  content: {
    title?: string;
    summary: string;
    note?: string;
    findings: {
      title: string;
      observation: string;
      evidence: string[];
      action: string;
      check: string;
      certainty?: string;
      remarkRefs?: string[];
      assessmentRefs?: string[];
      skillName?: string;
      recordedNotes?: {ref:string;note:string;tags:string[]}[];
    }[];
  };
  snapshot?: any;
};
export type Boot = {
  classes: ClassRoom[];
  exams: ExamSummary[];
  topics: string[];
  tags: string[];
  settings: Settings;
  dataDir: string;
};
declare global {
  interface Window {
    desktop?: {
      exportPdf: (html: string) => Promise<string | null>;
      openDataFolder: () => Promise<string>;
    };
  }
}
