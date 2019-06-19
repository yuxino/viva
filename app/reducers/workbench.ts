import produce from 'immer';
import WorkBenchActions from '../actions/workbench';

export const initState = function() {
  return {
    visible: false
  };
};

export default (state = initState(), action) =>
  produce(state, draft => {
    switch (action.type) {
      case WorkBenchActions.OPEN_WORKBENCH: {
        draft.visible = true;
        break;
      }
      case WorkBenchActions.CLOSE_WORKBENCH: {
        draft.visible = false;
        break;
      }
    }
  });
