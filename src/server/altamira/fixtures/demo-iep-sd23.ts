/**
 * FICTIONAL IEP in the layout of the Central Okanagan Public Schools (SD23) IEP form, for the dev "Run full demo day"
 * button. Every name, number and address is made up (PEN "FICT-000-123", 555 phone numbers). No real student.
 *
 * The text keeps the section headings the CB-IEP text importer reads (STUDENT INFORMATION, STUDENT PROFILE,
 * CORE COMPETENCIES, GOALS, ADAPTATIONS / ACCOMMODATIONS, SUPPORTS AND SERVICES, MODIFICATIONS) and its field labels
 * (Legal Name, Preferred Name, Grade, Designation, IEP Review Date, Strengths, Interests, Stretches). The other form
 * fields (PLAN dates, PEN, parents, support team) are kept as plain lines the importer skips. The same text is in
 * docs/demo/sample-iep-sd23.txt (a test keeps them equal).
 */

export const DEMO_STUDENT = {
  firstName: 'Simran',
  lastName: 'Grewal',
  preferredName: 'Simi',
  grade: '3',
  /** Home language of the family: the monthly family summary is translated into it. BCP 47 tag. */
  homeLanguage: 'pa',
  homeLanguageName: 'Punjabi',
} as const

/** The fictional parent: a new user linked to the demo student only. */
export const DEMO_PARENT = { id: 'u5e00000-0000-4000-8000-000000000009', displayName: 'Gurpreet Dhillon' } as const

export const DEMO_IEP_SD23_TEXT = `INDIVIDUAL EDUCATION PLAN (IEP)
Central Okanagan Public Schools (SD23) form layout - FICTIONAL SAMPLE, NOT A REAL STUDENT
PLAN Date: 2026-09-22
PLAN Review Date: 2027-06-10

STUDENT INFORMATION
Legal Name: Simran Grewal
Preferred Name: Simi
PEN: FICT-000-123
Grade: 3
Birth Date: 2017-04-14
Home Language: Punjabi
Home School: Salmonberry Creek Elementary (fictional)
Case Manager: Leila Ahmadi
Designation: Autism Spectrum Disorder (BC Category G)
Additional Designations: None
IEP Review Date: 2027-06-10

Parent/Guardian Information
Parent/Guardian 1: Gurpreet Dhillon
Parent/Guardian 2: Harjit Grewal
Consulted in developing this plan: [x] Yes  [ ] No
Address: 100 Example Crescent, Kelowna, BC (fictional)
Home Phone: 250-555-0142
Cell Phone: 250-555-0143

Student Support Team
Leila Ahmadi - Case Manager, Learning Support
Marcus Tran - Classroom Teacher
Priya Sandhu - Education Assistant (full-time, funded)
Gurpreet Dhillon - Parent/Guardian

STUDENT PROFILE
My Learning Preferences: I learn best with pictures, a visual schedule and one step at a time. I like to know what comes next.
Strengths:
- Remembers facts about animals and rivers
- Follows a visual schedule well
- Kind to classmates when the room is calm
Interests:
- Salmon, bears and other animals
- Drawing animal pictures
- Building with blocks
Stretches:
- Asking an adult for help in words or with a picture card
- Answering questions about what she read
- Noticing early signs of feeling overwhelmed
- Starting and finishing short tasks with fewer prompts

CORE COMPETENCIES
Communication: Uses single words and short phrases; is learning to ask for help and to take turns in talking.
Thinking: Notices details and patterns; understands more than she says.
Personal and Social: Is learning to use her break card and to return to work after a break.

GOALS
Goal 1 - Area: Communication
By June 2027, the student will ask an adult for help or request a turn using a word, a picture card or a short phrase, at least 5 times per day across the school day, with no more than one prompt each time.
Goal 2 - Area: Reading comprehension
By June 2027, after a grade 2 to 3 level passage with pictures, the student will answer who, what and where questions and retell the main idea with 80% accuracy on 3 consecutive checks.
Goal 3 - Area: Self-regulation
By June 2027, the student will use her break card to ask for a break before feeling overwhelmed and will return to the task within 5 minutes, in 4 of 5 observed work periods.
Goal 4 - Area: Independence
By June 2027, the student will start and finish a short writing task of two sentences, moving from a verbal prompt to a gesture prompt to independent, in 3 of 4 tasks.

ADAPTATIONS / ACCOMMODATIONS
- Visual schedule for the day, with first-then board
- Instructions given one step at a time, with a picture or model
- Reading passages with pictures and key words highlighted
- Noise-reducing headphones during independent work
- Extra time and a quiet space for written tasks
- Warning before a change in routine

SUPPORTS AND SERVICES
- Full-time funded Education Assistant (EA) support across the school day
- Break card and a calm corner
- Speech-language pathologist consult, twice per term
- Communication picture cards on the desk

MODIFICATIONS
None
`

/** The mock grade 3 science lesson the teacher adapts in the demo day. Fictional text. */
export const DEMO_LESSON = {
  title: 'The life cycle of a salmon',
  text: `Grade 3 Science: The life cycle of a salmon
Learning goal: I can describe the stages in the life cycle of a salmon and explain why salmon return to the river.

Reading passage
Salmon begin life as eggs in the gravel of a river. After a few months the eggs hatch into small fish called alevins. The alevins live off a yolk sac. When the yolk is gone they become fry and begin to eat tiny insects. Young salmon, called smolts, swim down the river to the ocean. They live in the ocean for one to four years and grow large. Then the adult salmon swim back to the river where they were born. They lay their eggs in the gravel, and the life cycle begins again.

Worksheet
1. Write the four stages of the salmon life cycle in order.
2. Draw one stage and write two sentences about it.
3. Explain in a paragraph why salmon return to the river where they were born.

Group activity
In groups of four, cut out the stage cards and arrange them in a circle on a large sheet of paper. Take turns reading one card aloud and tell your group where it goes. Present your life cycle circle to the class.`,
} as const

/** A short Punjabi sample translation, used only when the AI could not translate the monthly family summary (the fixture provider only writes English). */
export const DEMO_PUNJABI_SAMPLE = 'ਇਸ ਮਹੀਨੇ ਤੁਹਾਡੇ ਬੱਚੇ ਨੇ ਆਪਣੇ ਟੀਚਿਆਂ ਉੱਤੇ ਕੰਮ ਕੀਤਾ। ਸਾਡੀ ਟੀਮ ਮਦਦ ਕਰ ਰਹੀ ਹੈ। ਕਿਰਪਾ ਕਰਕੇ ਕਿਸੇ ਵੀ ਸਮੇਂ ਸਾਡੇ ਨਾਲ ਸੰਪਰਕ ਕਰੋ।'
