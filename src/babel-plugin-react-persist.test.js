import * as babel from '@babel/core'
import jsxPlugin from '@babel/plugin-syntax-jsx'
import useCallbackPlugin from '.'

describe('babel-plugin-react-persist', () => {
  it('should replace defined functions', () => {
    const code = transform(`
      () => {
        const callback = () => {
          alert('clicked')
        }

        return (
          <button onClick={callback} />
        )
      }
    `)

    expect(code).toEqual(freeText(`
      () => {
        const callback = React.useCallback(() => {
          alert('clicked');
        }, []);
        return <button onClick={callback} />;
      };
    `))
  })

  it('should useCallback() for inline functions', () => {
    const code = transform(`
      () => {
        return (
          <button onClick={() => alert('clicked')} />
        )
      }
    `)

    expect(code).toEqual(freeText(`
      let _anonymousFnComponent;

      () => {
        return React.createElement(_anonymousFnComponent = _anonymousFnComponent || (() => {
          const _onClick = React.useCallback(() => alert('clicked'), []);

          return <button onClick={_onClick} />;
        }), null);
      };
    `))
  })

  it('should provide useCallback() with the used arguments', () => {
    const code = transform(`
      ({ text }) => {
        return (
          <button onClick={() => alert(text)} />
        )
      }
    `)

    expect(code).toEqual(freeText(`
      let _anonymousFnComponent;

      ({
        text
      }) => {
        return React.createElement(_anonymousFnComponent = _anonymousFnComponent || (() => {
          const _onClick = React.useCallback(() => alert(text), [text]);

          return <button onClick={_onClick} />;
        }), null);
      };
    `))
  })

  it('should avoid specifying function arguments as useCallback() arguments', () => {
    const code = transform(`
      ({ text }) => {
        return (
          <button onClick={(e) => alert(text)} />
        )
      }
    `)

    expect(code).toEqual(freeText(`
      let _anonymousFnComponent;

      ({
        text
      }) => {
        return React.createElement(_anonymousFnComponent = _anonymousFnComponent || (() => {
          const _onClick = React.useCallback(e => alert(text), [text]);

          return <button onClick={_onClick} />;
        }), null);
      };
    `))
  })

  it('should NOT useCallback() for external functions', () => {
    const code = transform(`
      const onClick = () => {
        alert('clicked')
      }

      () => {
        return (
          <button onClick={onClick} />
        )
      }
    `)

    expect(code).toEqual(freeText(`
      const onClick = () => {
        alert('clicked');
      };

      () => {
        return <button onClick={onClick} />;
      };
    `))
  })

  it('should NOT useCallback() for functions that do not return a JSX element', () => {
    const code = transform(`
      () => {
        const onLoad = () => {
          alert('loaded')
        }

        window.onload = onLoad
      }
    `)

    expect(code).toEqual(freeText(`
      () => {
        const onLoad = () => {
          alert('loaded');
        };

        window.onload = onLoad;
      };
    `))
  })

  it('should create a scope and useCallback() for inline return statements', () => {
    const code = transform(`
      ({ history }) => (
        <button onClick={() => history.pop()} />
      )
    `)

    expect(code).toEqual(freeText(`
      let _anonymousFnComponent;

      ({
        history
      }) => React.createElement(_anonymousFnComponent = _anonymousFnComponent || (() => {
        const _onClick = React.useCallback(() => history.pop(), [history, history.pop]);

        return <button onClick={_onClick} />;
      }), null);
    `))
  })

  it('should create a scope and useCallback() for inline mapping functions under JSX blocks', () => {
    const code = transform(`
      ({ data, history }) => (
        <div>
          <button onClick={() => history.pop()} />
          <ul>
            {data.map(({ id, value }) => (
              <li key={id} onClick={() => history.push(\`/data/$\{id\}\`)}>{value}</li>
            ))}
          </ul>
        </div>
      )
    `)

    expect(code).toEqual(freeText(`
      let _anonymousFnComponent, _anonymousFnComponent2;

      ({
        data,
        history
      }) => React.createElement(_anonymousFnComponent2 = _anonymousFnComponent2 || (() => {
        const _onClick2 = React.useCallback(() => history.pop(), [history, history.pop]);

        return <div>
                <button onClick={_onClick2} />
                <ul>
                  {data.map(({
              id,
              value
            }) => React.createElement(_anonymousFnComponent = _anonymousFnComponent || (() => {
              const _onClick = React.useCallback(() => history.push(\`/data/\$\{id\}\`), [history, history.push, id]);

              return <li key={id} onClick={_onClick}>{value}</li>;
            }), {
              key: id
            }))}
                </ul>
              </div>;
      }), null);
    `))
  })

  it('should create a scope and useCallback() for conditional statements with JSX elements', () => {
    const code = transform(`
      ({ foo }) => (
        <div>
          {foo ? (
            <button onClick={() => alert('foo')} />
          ) : (
            <button onClick={() => alert('not foo')} />
          )}
        </div>
      )
    `)

    expect(code).toEqual(freeText(`
      let _anonymousFnComponent, _anonymousFnComponent2;

      ({
        foo
      }) => <div>
                {foo ? React.createElement(_anonymousFnComponent = _anonymousFnComponent || (() => {
          const _onClick = React.useCallback(() => alert('foo'), []);

          return <button onClick={_onClick} />;
        }), null) : React.createElement(_anonymousFnComponent2 = _anonymousFnComponent2 || (() => {
          const _onClick2 = React.useCallback(() => alert('not foo'), []);

          return <button onClick={_onClick2} />;
        }), null)}
              </div>;
    `))
  })

  it('should transform inline functions for JSX elements in if statements', () => {
    const code = transform(`
      ({ foo }) => {
        if (foo) {
          return (
            <button onClick={() => alert('foo')} />
          )
        }

        return (
          <button onClick={() => alert('not foo')} />
        )
      }
    `)

    expect(code).toEqual(freeText(`
      let _anonymousFnComponent, _anonymousFnComponent2;

      ({
        foo
      }) => {
        if (foo) {
          return React.createElement(_anonymousFnComponent = _anonymousFnComponent || (() => {
            const _onClick = React.useCallback(() => alert('foo'), []);

            return <button onClick={_onClick} />;
          }), null);
        }

        return React.createElement(_anonymousFnComponent2 = _anonymousFnComponent2 || (() => {
          const _onClick2 = React.useCallback(() => alert('not foo'), []);

          return <button onClick={_onClick2} />;
        }), null);
      };
    `))
  })

  it('should useMemo() with the right arguments for const declarations', () => {
    const code = transform(`
      export default ({
        data,
        sortComparator,
        filterPredicate,
      }) => {
        const transformedData = data
          .filter(filterPredicate)
          .sort(sortComparator)

        return (
          <ul>
            {transformedData.map(d => <li>d</li>)}
          </ul>
        )
      }
    `)

    expect(code).toEqual(freeText(`
      export default (({
        data,
        sortComparator,
        filterPredicate
      }) => {
        const transformedData = React.useMemo(() => data.filter(filterPredicate).sort(sortComparator), [data, data.filter, filterPredicate, sortComparator]);
        return <ul>
                  {transformedData.map(d => <li>d</li>)}
                </ul>;
      });
    `))
  })

  it('should NOT use hooks for let declarations', () => {
    const code = transform(`
      export default ({
        data,
        sortComparator,
        filterPredicate,
      }) => {
        let transformedData = []
        transformedData = data
          .filter(filterPredicate)
          .sort(sortComparator)

        return (
          <ul>
            {transformedData.map(d => <li>d</li>)}
          </ul>
        )
      }
    `)

    expect(code).toEqual(freeText(`
      export default (({
        data,
        sortComparator,
        filterPredicate
      }) => {
        let transformedData = [];
        transformedData = data.filter(filterPredicate).sort(sortComparator);
        return <ul>
                  {transformedData.map(d => <li>d</li>)}
                </ul>;
      });
    `))
  })

  it('should NOT replace hooks declarations', () => {
    const code = transform(`
      () => {
        const callback = useCallback(() => {
          alert('clicked')
        }, [])

        return (
          <button onClick={callback} />
        )
      }
    `)

    expect(code).toEqual(freeText(`
      () => {
        const callback = useCallback(() => {
          alert('clicked');
        }, []);
        return <button onClick={callback} />;
      };
    `))
  })
})

const transform = (code) => {
  return babel.transformSync(code, {
    plugins: [useCallbackPlugin, jsxPlugin],
    code: true,
    ast: false,
  }).code
}

// Will use the shortest indention as an axis
export const freeText = (text) => {
  if (text instanceof Array) {
    text = text.join('')
  }

  // This will allow inline text generation with external functions, same as ctrl+shift+c
  // As long as we surround the inline text with ==>text<==
  text = text.replace(
    /( *)==>((?:.|\n)*?)<==/g,
    (match, baseIndent, content) =>
  {
    return content
      .split('\n')
      .map(line => `${baseIndent}${line}`)
      .join('\n')
  })

  const lines = text.split('\n')

  const minIndent = lines.filter(line => line.trim()).reduce((minIndent, line) => {
    const currIndent = line.match(/^ */)[0].length

    return currIndent < minIndent ? currIndent : minIndent
  }, Infinity)

  return lines
    .map(line => line.slice(minIndent))
    .join('\n')
    .trim()
    .replace(/\n +\n/g, '\n\n')
}
