import { useState, useEffect } from 'react';

export function useFetch(request) {
  const [data, setData] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const data = await request();
      setData(data);
      setLoading(false);
    })();
  }, []);

  return [data, loading];
}

export function useVModel(initValue) {
  const [state, setState] = useState(initValue);
  function handleInput(e) {
    setState(e.target.value);
  }
  return [state, handleInput];
}
