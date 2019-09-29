import produce from 'immer';
import WorkBenchActions from '../actions/Workbench';

export const initState = function() {
  return {
    title: 'hahaha好',
    visible: false
  };
};

export default (state = initState(), action) =>
  produce(state, draft => {
    switch (action.type) {
      case WorkBenchActions.OPEN_WORKBENCH: {
        draft.visible = true;
        draft.title = action.payload.title;
        break;
      }
      case WorkBenchActions.CLOSE_WORKBENCH: {
        draft.visible = false;
        draft.title = action.payload.title;
        break;
      }
    }
  });
