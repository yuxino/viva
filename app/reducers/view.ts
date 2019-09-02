import produce from 'immer';
import ViewActions from '../actions/View';

export const initState = function() {
  return {
    edtiorSyncFn: null
  };
};

export default (state = initState(), action) =>
  produce(state, draft => {
    switch (action.type) {
      // keep sync editor content function
      case ViewActions.UPDATE_EDITOR_SYNC_FN: {
        draft.edtiorSyncFn = action.payload.edtiorSyncFn;
        break;
      }
      // clear editor content
      case ViewActions.CLEAR_EDITOR_CONTENT: {
        draft.edtiorSyncFn();
      }
    }
  });
