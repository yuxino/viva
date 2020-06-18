import { useState, useEffect } from 'react';

// fetch hook
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

// like vue v-model to bind data
export function useVModel(initValue) {
  const [state, setState] = useState(initValue);
  function handleInput(e) {
    setState(e.target.value);
  }
  return [state, handleInput];
}
