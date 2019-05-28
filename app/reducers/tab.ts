import produce from 'immer';

export const initState = function() {
  return {
    openedFiles: []
  };
};

export default (state = initState(), action) =>
  produce(state, draft => {
    // do sth ..
  });
