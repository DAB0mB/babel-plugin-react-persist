import generate from '@babel/generator'
import { parse as superParse } from '@babel/parser'

export default ({ types: t }) => {
  let parserOpts

  // Original parse + provided options
  const parse = (code) => {
    return superParse(code, parserOpts)
  }

  const getAllOwnBindings = (scope) => {
    const allBindings = scope.getAllBindings()

    return Object.keys(allBindings).reduce((ownBindings, bindingName) => {
      const binding = allBindings[bindingName]

      if (scope.hasOwnBinding(bindingName)) {
        ownBindings[bindingName] = binding
      }

      return ownBindings
    }, {})
  }

  // Return a unique list
  const getAllIdentifierNames = (parentPath) => {
    const identifiers = []

    parentPath.traverse({
      Identifier(path) {
        // Unique identifier
        if (identifiers.includes(path.node.name)) return
        // Not global
        if (!parentPath.scope.hasBinding(path.node.name)) return

        // Not one of the function parameters, if it's a function
        if (
          parentPath.node.params &&
          parentPath.node.params.some(param => param.name === path.node.name)
        ) {
          return
        }

        identifiers.push(path.node.name)
      },
    })

    return identifiers
  }

  // Arrow function or regular function
  const isAnyFunctionExpression = (node) => {
    return node && (
      t.isArrowFunctionExpression(node) ||
      t.isFunctionExpression(node)
    )
  }

  // If expression ends up with a useXXX()
  const isReactHook = (node) => {
    return /^use/.test(node.name) || /^use/.test(node.property.name)
  }

  // Example output: const foo = useCallback(() => alert(text), [text])
  const generateCallback = (callbackName, callbackBody) => {
    const identifiers = getAllIdentifierNames(callbackBody)
    callbackBody = generate(callbackBody.node).code

    return parse(`
      const ${callbackName} = React.useCallback(${callbackBody}, [${identifiers}])
    `).program.body[0]
  }

  // Example output: const foo = useMemo(() => bar, [bar])
  const generateMemo = (memoName, memoBody) => {
    const identifiers = getAllIdentifierNames(memoBody)
    memoBody = generate(memoBody.node).code

    return parse(`
      const ${memoName} = React.useMemo(() => ${memoBody}, [${identifiers}])
    `).program.body[0]
  }

  const isWrappedWithCreateElement = (path) => {
    return (
      path.parentPath &&
      path.parentPath.parentPath &&
      path.parentPath.parentPath.parentPath &&
      t.isCallExpression(path.parentPath.parentPath.parentPath.node) &&
      t.isMemberExpression(path.parentPath.parentPath.parentPath.node.callee) &&
      path.parentPath.parentPath.parentPath.node.callee.object.name === 'React' &&
      path.parentPath.parentPath.parentPath.node.callee.property.name === 'createElement'
    )
  }

  const getKeyPropsString = (node) => {
    if (!t.isJSXElement(node)) return 'null'

    const keyAttr = node.openingElement.attributes.find((attr) => {
      return attr.name.name == 'key'
    })

    if (!keyAttr) return 'null'

    let key
    if (t.isJSXExpressionContainer(keyAttr.value)) {
      key = generate(keyAttr.value.expression).code
    }
    else if (t.isLiteral(keyAttr.value)) {
      key = generate(keyAttr.value).code
    }
    else {
      return 'null'
    }

    return `{ key: ${key} }`
  }

  return {
    pre({ opts }) {
      // Store original parse options
      parserOpts = opts.parserOpts
    },

    visitor: {
      // Add scope to arrow functions and JSX blocks e.g.
      // <el /> will become React.createElement(() => { return <el /> }, null)
      // this way we can use nested hooks
      JSXElement(path) {
        let returnValue = path
        let container = path.parentPath
        while (
          t.isJSXElement(container.node) ||
          t.isConditionalExpression(container.node) ||
          t.isLogicalExpression(container.node)
        ) {
          returnValue = returnValue.parentPath
          container = container.parentPath
        }

        if (!container) return
        // Container must be an arrow function or a JSX block
        if (
          !t.isArrowFunctionExpression(container.node) &&
          !t.isJSXExpressionContainer(container.node)
        ) {
          return
        }

        if (!isWrappedWithCreateElement(returnValue)) {
          const scopedReturnValue = parse(`
            React.createElement(() => {
              ${generate(returnValue.node).code}
            }, ${getKeyPropsString(returnValue.node)})
          `).program.body[0].expression

          returnValue.replaceWith(scopedReturnValue)
        }
      },

      // Add useCallback() for all inline functions
      JSXAttribute(path) {
        if (!t.isJSXExpressionContainer(path.node.value)) return
        if (!isAnyFunctionExpression(path.node.value.expression)) return

        let returnStatement = path
        while (returnStatement && !t.isReturnStatement(returnStatement)) {
          returnStatement = returnStatement.parentPath

          if (t.isJSXExpressionContainer(returnStatement)) return
        }

        if (!returnStatement) return
        if (!isAnyFunctionExpression(returnStatement.parentPath.parentPath.node)) return

        const callbackName = path.scope.generateUidIdentifier(path.node.name.name).name
        const callbackBody = path.get('value.expression')
        const callback = generateCallback(callbackName, callbackBody)

        callbackBody.replaceWithSourceString(callbackName)
        returnStatement.insertBefore(callback)
      },

      // For all *final* return statements, go through all const declarations
      // and replace them with useCallback() or useMemo()
      ReturnStatement(path) {
        if (!t.isJSXElement(path.node.argument)) return

        if (!isWrappedWithCreateElement(path)) {
          const returnStatement = parse(`
            () => {
              return React.createElement(() => {
                ${generate(path.node).code}
              }, ${getKeyPropsString(path.node.argument)})
            }
          `).program.body[0].expression.body.body[0]

          path.replaceWith(returnStatement)

          return
        }

        const ownBindings = getAllOwnBindings(path.scope)

        Object.keys(ownBindings).forEach((bindingName) => {
          const binding = ownBindings[bindingName]

          if (!binding.constant) return
          if (!t.isVariableDeclarator(binding.path.node)) return
          if (
            t.isCallExpression(binding.path.node.init) &&
            isReactHook(binding.path.node.init.callee)
          ) {
            return
          }

          const generateReplacement = isAnyFunctionExpression(binding.path.node.init)
            ? generateCallback
            : generateMemo
          const wrappedAssignment = generateReplacement(
            bindingName,
            binding.path.get('init')
          )

          binding.path.parentPath.replaceWith(wrappedAssignment)
        })
      },
    },
  }
}
