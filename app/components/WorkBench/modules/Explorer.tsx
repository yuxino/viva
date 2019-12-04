import * as React from 'react';
import { useMappedState } from 'redux-react-hook';

function Explorer() {
  const { root } = useMappedState(({ Explore }) => ({
    root: Explore.root
  }));
  return <div>{root}</div>;
}

export default Explorer;
