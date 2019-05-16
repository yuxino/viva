import * as React from 'react';
import { useMappedState, useDispatch } from 'redux-react-hook';

export default () => {
  const { counter } = useMappedState(state => ({
    counter: state.counter
  }));

  const dispath = useDispatch();
  const add = () => dispath({ type: 'INCREMENT' });
  const odd = () => dispath({ type: 'DECREMENT' });
  const addAsync = () => dispath({ type: 'INCREMENT_ASYNC' });

  return (
    <>
      Count: {counter}
      <p>
        <button onClick={add}>+</button>
        <button onClick={odd}>-</button>
        <button onClick={addAsync}>async</button>
      </p>
    </>
  );
};
