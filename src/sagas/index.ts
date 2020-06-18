import { all } from "redux-saga/effects";
import ViewSaga from "./View.saga";
import WorkbenchSaga from "./Workbench.saga";

function* watchAll() {
  yield all([...ViewSaga, ...WorkbenchSaga]);
}

export default watchAll;
