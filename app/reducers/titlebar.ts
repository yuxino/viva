import produce from 'immer';

export const initState = function() {
  return {
    title: ''
  };
};

export default (state = initState(), action) =>
  produce(state, draft => {
    // do sth ..
    // switch 'TITILEBAR_UPDATE_TITLE':
  });
