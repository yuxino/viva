import produce from 'immer';
import ExplorerActions from '../actions/Explore';

export const initState = function() {
  return {
    root: ''
  };
};

export default (state = initState(), action) =>
  produce(state, draft => {
    switch (action.type) {
      case ExplorerActions.UPDATE_ROOT_PATH: {
        console.log(action);
        draft.root = action.payload.root;
      }
    }
  });
