import produce from 'immer';
import TitleBarActions from '../actions/Titlebar';

export const initState = function() {
  return {
    title: ''
  };
};

export default (state = initState(), action) =>
  produce(state, draft => {
    switch (action.type) {
      case TitleBarActions.UPDATE_TITLE: {
        draft.title = action.payload.title;
      }
    }
  });
