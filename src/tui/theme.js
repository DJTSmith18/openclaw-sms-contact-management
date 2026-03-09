'use strict';

const COLORS = {
  bg:          'black',
  fg:          'white',
  border:      'cyan',
  borderFocus: 'green',
  title:       'cyan',
  header:      'bold',
  selected:    'green',
  selectedBg:  'black',
  error:       'red',
  success:     'green',
  warning:     'yellow',
  dim:         'gray',
  accent:      'cyan',
  inputBg:     'black',
  inputFg:     'white',
  tableBorder: 'blue',
  tableHeader: 'cyan',
};

const STYLES = {
  box: {
    border: { type: 'line' },
    style: {
      border: { fg: COLORS.border },
      focus: { border: { fg: COLORS.borderFocus } },
    },
  },
  list: {
    border: { type: 'line' },
    style: {
      border: { fg: COLORS.border },
      focus: { border: { fg: COLORS.borderFocus } },
      selected: { fg: COLORS.selected, bold: true },
      item: { fg: COLORS.fg },
    },
  },
  input: {
    border: { type: 'line' },
    style: {
      border: { fg: COLORS.border },
      focus: { border: { fg: COLORS.borderFocus } },
      fg: COLORS.inputFg,
      bg: COLORS.inputBg,
    },
  },
};

module.exports = { COLORS, STYLES };
