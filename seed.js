'use strict';

// Adds sample content so the site has something to show in a demo: submissions with map pins,
// polls, notices and two officer accounts. Safe to run again: anything already there is left alone.
//
// Run:  npm run seed
// To start clean again, stop the server and delete the "data" and "uploads" folders.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('./src/db');
const auth = require('./src/auth');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8').replace(/^﻿/, ''));
// Each sample sits in a real district and town; its pin is placed near that district's centre,
// or near the town's own centre when the town is not the district headquarters.
const PLACES = [
  ['Deep potholes', 'mysuru', 'Mysuru'],
  ['Street lights not working', 'belagavi', 'Belagavi'],
  ['Speed breakers', 'dharwad', 'Hubballi', [15.35, 75.14]],
  ['Water supply comes only', 'kalaburagi', 'Kalaburagi'],
  ['Open drain overflows', 'udupi', 'Udupi'],
  ['Separate wet and dry', 'shivamogga', 'Shivamogga'],
  ['Mosquito fogging', 'dakshina-kannada', 'Mangaluru'],
  ['Benches and a walking track', 'davanagere', 'Davanagere'],
  ['Publish ward meeting dates', 'tumakuru', 'Tumakuru'],
  ['CCTV cameras', 'bengaluru-urban', 'Bengaluru'],
  ['Birth certificate counter', 'hassan', 'Hassan'],
  ['Keep the public library', 'dharwad', 'Dharwad'],
  ['New bus shelter', 'vijayapura', 'Vijayapura'],
  ['Garbage not collected', 'ballari', 'Ballari'],
];
function placeOf(title) {
  const [, district, town, townCenter] = PLACES.find(([start]) => title.startsWith(start)) || [];
  const entry = (config.districts || []).find((d) => d.id === district);
  return { district, town, center: townCenter || (entry ? entry.center : (config.map && config.map.center) || [15, 76.2]) };
}
const departmentOf = (categoryId) => (config.categories.find((c) => c.id === categoryId) || {}).department || null;

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days) => new Date(Date.now() - days * DAY).toISOString();
const voter = () => `seed-${crypto.randomBytes(12).toString('hex')}`;

// `pin` is the distance from the district centre in config.json, in thousandths of a degree (about 110 m each).
const samples = [
  {
    type: 'issue', category: 'roads', ward: 'Ward 4', location: 'Main road, near the vegetable market', pin: [2.1, -3.4],
    title: 'Deep potholes on the main road near the vegetable market',
    description: 'There are four or five deep potholes on the stretch between the vegetable market and the bus stand. Two-wheelers swerve into oncoming traffic to avoid them, and after rain they fill with water so you cannot see how deep they are.\n\nPlease repair this stretch before the monsoon gets heavier.',
    author: 'Lakshmi R.', days: 34, votes: 48,
    updates: [
      { status: 'under_review', days: 31, note: 'Thank you. The ward engineer inspected the stretch and confirmed six potholes.' },
      { status: 'planned', days: 22, note: null },
      { status: 'in_progress', days: 6, note: 'Patch work has been approved and the contractor started on the market side this week. The full stretch should be done in about ten days.' },
    ],
    comments: [
      { name: 'Imran', days: 30, body: 'My father fell from his scooter here last month. Please treat this as urgent.' },
      { name: null, days: 12, body: 'The one in front of the medical shop is the worst.' },
    ],
  },
  {
    type: 'issue', category: 'lights', ward: 'Ward 7', location: 'Lane behind the government school', pin: [-4.6, 5.2],
    title: 'Street lights not working on the lane behind the government school',
    description: 'Five street lights in a row have been off for more than three weeks. Children coming back from evening tuition and women returning from work walk through here in complete darkness.',
    author: 'Suresh K.', days: 58, votes: 31, fixed: [9, 1],
    updates: [
      { status: 'under_review', days: 55, note: null },
      { status: 'in_progress', days: 49, note: 'The fault is in the underground cable, not the bulbs. The electrical section has been asked to replace it.' },
      { status: 'implemented', days: 41, note: 'The cable was replaced and all five lights are working again. Please reply here if any of them fail.' },
    ],
    comments: [{ name: 'Suresh K.', days: 40, body: 'Confirmed, all lights are on now. Thank you.' }],
  },
  {
    type: 'suggestion', category: 'transport', ward: 'Ward 3', location: 'In front of the primary school', pin: [6.3, 1.8],
    title: 'Speed breakers and a zebra crossing in front of the primary school',
    description: 'Vehicles come down the slope very fast right where small children cross the road at 9 am and 4 pm. A pair of speed breakers, a painted zebra crossing and a "School ahead" sign would make a big difference.',
    author: 'Parent group, Ward 3', days: 47, votes: 44,
    updates: [
      { status: 'under_review', days: 44, note: 'Forwarded to the traffic police for their opinion, which is required before any speed breaker is built.' },
      { status: 'planned', days: 19, note: 'The traffic police have agreed. Two speed breakers and the crossing are included in next month\'s works list.' },
    ],
    comments: [
      { name: 'Anita', days: 43, body: 'Please also post a traffic warden for the school timings until the work is done.' },
      { name: 'Ravi', days: 20, body: 'Good news. Request that the speed breakers be painted so they are visible at night.' },
      { name: null, days: 8, body: 'Supporting this. My daughter studies there.' },
    ],
  },
  {
    type: 'issue', category: 'water', ward: 'Ward 9', location: '3rd cross', pin: [-7.8, -2.9],
    title: 'Water supply comes only at 3 am in our street',
    description: 'For the last two months, water in 3rd cross is released between 3 am and 4 am. Elderly residents and working people cannot stay awake for it, and many houses do not have a sump or overhead tank.\n\nCan the timing be shifted to early morning or evening, like the neighbouring streets?',
    author: null, days: 21, votes: 39,
    updates: [{ status: 'under_review', days: 17, note: 'We are checking the valve schedule with the water supply section and will reply here with a revised timing.' }],
    comments: [{ name: 'Meena', days: 16, body: 'Same problem in 4th cross.' }],
  },
  {
    type: 'issue', category: 'drainage', ward: 'Ward 6', location: 'Temple street', pin: [0.9, 7.4],
    title: 'Open drain overflows onto temple street whenever it rains',
    description: 'The drain along temple street is blocked with plastic and silt. Even a short spell of rain sends dirty water onto the road and into the ground-floor shops. The smell stays for days.',
    author: 'Temple street shopkeepers', days: 40, votes: 35,
    updates: [
      { status: 'under_review', days: 38, note: null },
      { status: 'in_progress', days: 9, note: 'Desilting started from the temple end. Covering slabs will be laid after the drain is cleared.' },
    ],
    comments: [],
  },
  {
    type: 'suggestion', category: 'waste', ward: 'Ward 2', location: 'Weekly market ground', pin: [3.5, -6.8],
    title: 'Separate wet and dry waste bins at the weekly market',
    description: 'After every weekly market the ground is covered with vegetable waste mixed with plastic covers. If large, clearly labelled wet and dry bins were placed at the four corners, vendors could be asked to use them and the wet waste could go for composting.',
    author: 'Kavya', days: 72, votes: 27,
    updates: [
      { status: 'under_review', days: 69, note: null },
      { status: 'planned', days: 50, note: 'Eight bins have been ordered. Vendors will be briefed by the health inspector when the bins arrive.' },
    ],
    comments: [{ name: 'Naveen', days: 60, body: 'Vendors should also be fined for leaving waste behind.' }],
  },
  {
    type: 'suggestion', category: 'waste', ward: 'Ward 10', location: null, pin: null,
    title: 'Mosquito fogging and drain spraying before the monsoon peaks',
    description: 'Dengue cases went up in our ward last year. Requesting a fixed weekly fogging schedule and spraying of stagnant water points, with the schedule published so residents know when to expect it.',
    author: 'Dr. Prakash', days: 26, votes: 25,
    updates: [{ status: 'planned', days: 14, note: 'A ward-wise fogging schedule is being prepared and will be put up on the notice board and this site.' }],
    comments: [],
  },
  {
    type: 'suggestion', category: 'parks', ward: 'Ward 5', location: 'Lake-side park', pin: [-2.4, -8.6],
    title: 'Benches and a walking track for the lake-side park',
    description: 'The park by the lake is used by many senior citizens every morning but there are only two benches and the path is uneven. A simple walking track around the edge and a few more benches under the trees would help a lot.',
    author: 'Morning walkers group', days: 12, votes: 22,
    updates: [],
    comments: [{ name: 'Geetha', days: 10, body: 'A drinking water point would be useful too.' }],
  },
  {
    type: 'suggestion', category: 'services', ward: 'Ward 8', location: null, pin: null,
    title: 'Publish ward meeting dates in advance, online and on notice boards',
    description: 'Most residents hear about ward meetings only after they are over. Please announce the date, time and agenda at least a week before, on the office notice board and on this website.',
    author: 'Farhan', days: 96, votes: 19, fixed: [2, 5],
    updates: [
      { status: 'under_review', days: 92, note: null },
      { status: 'implemented', days: 70, note: 'From this month, meeting dates and agendas are displayed on all ward office notice boards seven days in advance.' },
    ],
    comments: [{ name: 'Farhan', days: 20, body: 'The board in Ward 8 office still shows last month\'s date. Please check.' }],
  },
  {
    type: 'suggestion', category: 'safety', ward: 'Ward 4', location: 'Bus stand', pin: [1.2, -1.1],
    title: 'CCTV cameras at the bus stand',
    description: 'There have been several chain-snatching and pickpocketing incidents at the bus stand in the evenings. Cameras at the entrance and the waiting area would discourage this.',
    author: null, days: 110, votes: 14,
    updates: [
      { status: 'under_review', days: 105, note: null },
      { status: 'not_feasible', days: 88, note: 'The bus stand belongs to the state transport corporation, so the council cannot install equipment there. We have forwarded this request to the depot manager and the local police station.' },
    ],
    comments: [],
  },
  {
    type: 'feedback', category: 'services', ward: 'Ward 1', location: 'Council office', pin: [0.2, 0.3],
    title: 'Birth certificate counter was quick and helpful',
    description: 'I applied for my son\'s birth certificate last week and received it in two days. The staff at the counter explained the documents clearly. Please keep the token system, it saves a lot of confusion.',
    author: 'Shilpa', days: 15, votes: 8,
    updates: [{ status: 'under_review', days: 13, note: 'Thank you for taking the time to write. We have shared this with the counter staff.' }],
    comments: [],
  },
  {
    type: 'suggestion', category: 'other', ward: 'Ward 2', location: 'Public library', pin: [4.8, -4.9],
    title: 'Keep the public library reading room open on Sundays',
    description: 'Students preparing for competitive exams have nowhere quiet to study on Sundays, which is the only free day for many. Could the reading room open at least from 9 am to 1 pm?',
    author: 'Kiran', days: 5, votes: 12,
    updates: [],
    comments: [],
  },
  {
    type: 'feedback', category: 'transport', ward: 'Ward 5', location: 'Lake road bus shelter', pin: [-3.6, -6.1],
    title: 'New bus shelter is useful but it needs a light',
    description: 'Thank you for the new shelter on lake road. It is a relief in the rain. After 7 pm it is completely dark inside, though, and people prefer to stand outside on the road.',
    author: 'Deepa', days: 9, votes: 9,
    updates: [],
    comments: [],
  },
  {
    type: 'issue', category: 'waste', ward: 'Ward 11', location: '2nd cross', pin: [-8.9, 3.7],
    title: 'Garbage not collected in 2nd cross for a week',
    description: 'The collection vehicle has not come to 2nd cross since last Monday. Bags are piling up at the corner and dogs are tearing them open.',
    author: 'Rajesh', days: 1, votes: 6,
    updates: [],
    comments: [],
  },
];

const polls = [
  {
    question: 'Which problem should local councils fix first this year?',
    description: 'The result is shared with every city corporation and municipal council in the state before they plan next year\'s works.',
    options: [
      ['Potholed roads', 41],
      ['Street lights that do not work', 27],
      ['Open and overflowing drains', 33],
      ['Irregular garbage collection', 18],
    ],
    closesInDays: 20, days: 10,
  },
  {
    question: 'What time should the weekly market close?',
    description: null,
    options: [['8 pm', 22], ['9 pm', 47], ['10 pm', 15]],
    closed: true, days: 60,
  },
];

const notices = [
  {
    title: 'Ward committee meetings on the last Saturday of this month', pinned: true, days: 3,
    body: 'City corporations and municipal councils across the state hold ward committee meetings on the last Saturday of this month at 10:30 am, in each ward office.\n\nAgenda: works taken up from the suggestion box, the fogging schedule, and property tax camps. Residents are welcome to attend and speak.',
  },
  {
    title: 'Kalaburagi: water supply shutdown for pipeline repair', pinned: false, days: 6,
    body: 'Water supply to Wards 8, 9 and 10 of Kalaburagi city will be stopped next Tuesday from 9 am to 5 pm to repair the main pipeline near the overhead tank. Please store water in advance. Tankers will be available on request at the ward offices.',
  },
  {
    title: 'Mosquito fogging before the monsoon', pinned: false, days: 13,
    body: 'Local councils in every district will carry out fogging between 6 pm and 8 pm in all wards this month. Ask your ward office for the day in your area.\n\nPlease keep doors and windows open during fogging and cover food and drinking water.',
  },
];

const officers = [
  { username: 'roads', name: 'R. Nagaraj (sample)', department: 'engineering' },
  { username: 'health', name: 'S. Fathima (sample)', department: 'health' },
];

let added = 0;
let moved = 0;
for (const sample of samples) {
  const { district, town, center } = placeOf(sample.title);
  const lat = sample.pin ? Math.round((center[0] + sample.pin[0] / 1000) * 1e6) / 1e6 : null;
  const lng = sample.pin ? Math.round((center[1] + sample.pin[1] / 1000) * 1e6) / 1e6 : null;

  let row = db.findByTitle(sample.title);
  if (row) {
    // A sample from the one-town version: give it its district, town and a pin in that district.
    if (!row.district) {
      db.updateSuggestion(row.id, { district, town, lat, lng });
      moved += 1;
    }
  } else {
    const { id } = db.createSuggestion({
      type: sample.type,
      title: sample.title,
      description: sample.description,
      category: sample.category,
      department: departmentOf(sample.category),
      district,
      town,
      ward: sample.ward,
      location: sample.location,
      lat,
      lng,
      authorName: sample.author,
    }, daysAgo(sample.days));
    for (let vote = 0; vote < sample.votes; vote++) db.toggleVote(id, voter(), daysAgo(Math.random() * sample.days));
    for (const update of sample.updates) db.addUpdate(id, update.status, update.note, { at: daysAgo(update.days) });
    for (const comment of sample.comments) db.addComment(id, comment.name, comment.body, daysAgo(comment.days));
    row = db.findByTitle(sample.title);
    added += 1;
  }

  // "Is it really fixed?" answers for work the council marked as done.
  if (sample.fixed && row.status === 'implemented') {
    const current = db.getSuggestion(row.code, { admin: true }).fixed;
    if (current.yes + current.no === 0) {
      for (let i = 0; i < sample.fixed[0]; i++) db.setConfirmation(row.id, voter(), true);
      for (let i = 0; i < sample.fixed[1]; i++) db.setConfirmation(row.id, voter(), false);
    }
  }
}

let pollsAdded = 0;
if (db.countPolls() === 0) {
  for (const poll of polls) {
    const id = db.createPoll({
      question: poll.question,
      description: poll.description,
      options: poll.options.map(([label]) => label),
      closesAt: poll.closesInDays ? new Date(Date.now() + poll.closesInDays * DAY).toISOString() : null,
    }, daysAgo(poll.days));
    const saved = db.getPoll(id);
    saved.options.forEach((option, index) => {
      for (let vote = 0; vote < poll.options[index][1]; vote++) db.votePoll(id, option.id, voter());
    });
    if (poll.closed) db.setPollClosed(id, true);
    pollsAdded += 1;
  }
}

let noticesAdded = 0;
if (db.countNotices() === 0) {
  for (const notice of notices) {
    db.createNotice(notice, daysAgo(notice.days));
    noticesAdded += 1;
  }
}

// Sample officer accounts get random passwords, written to a local file next to the admin's.
const logins = [];
for (const officer of officers) {
  if (db.findAdmin(officer.username)) continue;
  const password = auth.generatePassword();
  auth.createOfficer({ ...officer, password });
  logins.push(`Username: ${officer.username}\nPassword: ${password}\nDepartment: ${officer.department}\n`);
}
if (logins.length) {
  fs.writeFileSync(path.join(db.DATA_DIR, 'sample-officer-logins.txt'), [
    'Suggestion Box: sample officer logins (sign in at /admin)',
    'Each officer sees only the submissions of their own department.',
    '',
    ...logins,
  ].join('\n'));
}

console.log(`Sample submissions added: ${added}${moved ? `, existing samples given a district and town: ${moved}` : ''}`);
console.log(`Polls added: ${pollsAdded}. Notices added: ${noticesAdded}. Officer accounts added: ${logins.length}.`);
if (logins.length) console.log('Officer logins are in data/sample-officer-logins.txt');
