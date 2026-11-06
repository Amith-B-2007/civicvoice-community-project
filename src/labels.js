'use strict';

// Fixed lists the code depends on. Labels are shown in the visitor's language.

const STATUSES = [
  { id: 'submitted', label: { en: 'Submitted', kn: 'ಸಲ್ಲಿಸಲಾಗಿದೆ', hi: 'प्राप्त' } },
  { id: 'under_review', label: { en: 'Under Review', kn: 'ಪರಿಶೀಲನೆಯಲ್ಲಿದೆ', hi: 'समीक्षाधीन' } },
  { id: 'planned', label: { en: 'Planned', kn: 'ಯೋಜಿಸಲಾಗಿದೆ', hi: 'नियोजित' } },
  { id: 'in_progress', label: { en: 'In Progress', kn: 'ಪ್ರಗತಿಯಲ್ಲಿದೆ', hi: 'कार्य जारी' } },
  { id: 'implemented', label: { en: 'Implemented', kn: 'ಜಾರಿಯಾಗಿದೆ', hi: 'पूर्ण' } },
  { id: 'not_feasible', label: { en: 'Not Feasible', kn: 'ಸಾಧ್ಯವಿಲ್ಲ', hi: 'संभव नहीं' } },
];

const TYPES = [
  { id: 'suggestion', label: { en: 'Suggestion', kn: 'ಸಲಹೆ', hi: 'सुझाव' } },
  { id: 'issue', label: { en: 'Problem', kn: 'ಸಮಸ್ಯೆ', hi: 'समस्या' } },
  { id: 'feedback', label: { en: 'Feedback', kn: 'ಅಭಿಪ್ರಾಯ', hi: 'प्रतिक्रिया' } },
];

const REPORT_REASONS = ['spam', 'abuse', 'personal', 'false', 'other'];

module.exports = { STATUSES, TYPES, REPORT_REASONS };
