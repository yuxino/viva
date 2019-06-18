import produce from 'immer';
import ViewActions from '../actions/view';

export const initState = function() {
  return {
    edtiorSyncFn: null
  };
};

export default (state = initState(), action) =>
  produce(state, draft => {
    switch (action.type) {
      case ViewActions.UPDATE_EDITOR_SYNC_FN: {
        draft.edtiorSyncFn = action.payload.edtiorSyncFn;
        break;
      }
    }
  });
