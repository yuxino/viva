import { combineReducers } from 'redux';
import Explore from './Explore';
import Tabs from './Tabs';
import Titlebar from './Titlebar';
import View from './View';
import Workbench from './WorkBench';

export default function createRootReducer() {
  return combineReducers({
    Explore,
    Tabs,
    Titlebar,
    View,
    Workbench
  });
}
