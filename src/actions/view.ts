enum View {
  // FOR REDUCERS
  ALL_UPDATE = "VIEW_ALL_UPDATE", // update all views  (SIDE_EFFECT)
  EXPLORE_UPDATE = "VIEW_EXPLORE_UPDATE", // update explore view (SIDE_EFFECT)
  UPDATE_EDITOR_SYNC_FN = "VIEW_UPDATE_EDITOR_SYNC_FN", // update sync function
  CALL_EDITOR_SYNC_FN = "VIEW_CALL_EDITOR_SYNC_FN", // call sync function
  CLEAR_EDITOR_CONTENT = "VIEW_CLEAR_EDITOR_CONTENT", // clear editor content
  SHOW_UNSUPPORT_VIEW = "SHOW_UNSUPPORT_VIEW", // show unsupport view
  HIDE_UNSUPPORT_VIEW = "HIDE_UNSUPPORT_VIEW", // hide unsupport view
  // FOR SAGA
  TABS_UPDATE = "VIEW_TABS_UPDATE", // update tabs view (SIDE_EFFECT)
  CLOSE_TAB = "VIEW_CLOSE_TAB", // when close a tab
  OPEN_DIR = "VIEW_OPEN_DIR", // when dir been drop to editor
  UNSUPPORT_TYPE = "VIEW_UNSUPPORT_TYPE", // unsupport file type
}

export default View;
