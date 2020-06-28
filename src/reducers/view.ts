import produce from "immer";
import ViewActions from "../actions/View";

export const initState = function () {
  return {
    edtiorSyncFn: null,
    showUnsupportView: false,
  };
};

export default (state = initState(), action) =>
  produce(state, (draft) => {
    switch (action.type) {
      // keep sync editor content function
      case ViewActions.UPDATE_EDITOR_SYNC_FN: {
        draft.edtiorSyncFn = action.payload.edtiorSyncFn;
        break;
      }
      // clear editor content
      case ViewActions.CLEAR_EDITOR_CONTENT: {
        draft.edtiorSyncFn();
        break;
      }
      case ViewActions.SHOW_UNSUPPORT_VIEW: {
        draft.showUnsupportView = true;
        break;
      }
      case ViewActions.HIDE_UNSUPPORT_VIEW: {
        draft.showUnsupportView = false;
        break;
      }
    }
  });
