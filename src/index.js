import generate from '@babel/generator'
import { parse as superParse } from '@babel/parser'

export default ({ types: t }) => {
  // JSX elements that should have their own scope with React.createElement()
  const jsxElementsToWrap = new Set()
  let parserOpts
  let program

  // Original parse + provided options
  const parse = code => {
    return superParse(code, parserOpts)
  }

  const getAllOwnBindings = scope => {
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
  const getValueExpressions = parentPath => {
    const values = []

    parentPath.traverse({
      // First collect root identifiers
      Identifier: {
        enter(path) {
          // Unique identifier
          if (values.includes(path.node.name)) return
          // Not global
          if (!parentPath.scope.hasBinding(path.node.name)) return

          // Not one of the function parameters, if it's a function
          if (
            parentPath.node.params &&
            parentPath.node.params.some(param => param.name === path.node.name)
          ) {
            return
          }

          values.push(path.node.name)
        },
      },

      // Once the root identifier has been collected, look at its member expressions
      MemberExpression: {
        exit(path) {
          // Much easier to go through the string in this case
          const expressionString = generate(path.node).code

          // Include expressions which only use . and not []
          if (/[^.$\w]/.test(expressionString)) return

          const rootIdentifier = expressionString.split('.')[0]

          if (!values.includes(rootIdentifier)) return
          if (values.includes(expressionString)) return

          values.push(expressionString)
        },
      },
    })

    return values
  }

  // Arrow function or regular function
  const isAnyFunctionExpression = node => {
    return node && (t.isArrowFunctionExpression(node) || t.isFunctionExpression(node))
  }

  // If expression ends up with a useXXX()
  const isReactHook = node => {
    return /^use/.test(node.name) || /^use/.test(node.property.name)
  }

  // Example output: const foo = useCallback(() => alert(text), [text])
  const generateCallback = (callbackName, callbackBody) => {
    const values = getValueExpressions(callbackBody)
    callbackBody = generate(callbackBody.node).code

    return parse(`
      const ${callbackName} = React.useCallback(${callbackBody}, [${values}])
    `).program.body[0]
  }

  // Example output: const foo = useMemo(() => bar, [bar])
  const generateMemo = (memoName, memoBody) => {
    const values = getValueExpressions(memoBody)
    memoBody = generate(memoBody.node).code

    return parse(`
      const ${memoName} = React.useMemo(() => ${memoBody}, [${values}])
    `).program.body[0]
  }

  // e.g. <el /> -> React.createElement(_anonymousFnComponent = _anonymousFnComponent || () => {
  //  return <el />
  // }, null)
  const generateElementWrapper = (id, jsxElement) => {
    return parse(`
      React.createElement(${id.name} = ${id.name} || (() => {
        return ${generate(jsxElement.node).code}
      }), ${getKeyPropsString(jsxElement.node)})
    `).program.body[0].expression
  }

  // Checks if given JSX element is wrapped with the function above
  const isWrappedWithCreateElement = path => {
    let currPath = path
    if (!currPath || !t.isJSXElement(currPath.node)) return false
    currPath = currPath.parentPath
    if (!currPath || !t.isReturnStatement(currPath.node)) return false
    currPath = currPath.parentPath
    if (!currPath || !t.isBlockStatement(currPath.node)) return false
    currPath = currPath.parentPath
    if (!currPath || !t.isArrowFunctionExpression(currPath.node)) return false
    currPath = currPath.parentPath
    if (!currPath || !t.isLogicalExpression(currPath.node)) return false
    currPath = currPath.parentPath
    if (!currPath || !t.isAssignmentExpression(currPath.node)) return false
    currPath = currPath.parentPath
    if (!currPath || !t.isCallExpression(currPath.node)) return false

    return (
      t.isMemberExpression(currPath.node.callee) &&
      currPath.node.callee.object.name === 'React' &&
      currPath.node.callee.property.name === 'createElement'
    )
  }

  // Will check for key attributes in the given JSX element and will return a JSON
  // that could be provided to a React.createElement()
  // e.g. key={t} -> { key: t }
  const getKeyPropsString = node => {
    if (!t.isJSXElement(node)) return 'null'

    const keyAttr = node.openingElement.attributes.find(attr => {
      return attr.name.name == 'key'
    })

    if (!keyAttr) return 'null'

    let key
    if (t.isJSXExpressionContainer(keyAttr.value)) {
      key = generate(keyAttr.value.expression).code
    } else if (t.isLiteral(keyAttr.value)) {
      key = generate(keyAttr.value).code
    } else {
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
      Program(path) {
        program = path
      },

      JSXElement: {
        exit(path) {
          if (!jsxElementsToWrap.has(path)) return

          const componentName = path.scope.generateUidIdentifier('anonymousFnComponent')
          program.scope.push({ id: componentName, kind: 'let' })

          const wrappedJSXElement = generateElementWrapper(componentName, path)
          path.replaceWith(wrappedJSXElement)

          jsxElementsToWrap.delete(path)
        },
      },

      // Add useCallback() for all inline functions
      JSXAttribute(path) {
        if (!t.isJSXExpressionContainer(path.node.value)) return
        if (!isAnyFunctionExpression(path.node.value.expression)) return

        let rootJSXElement = path.parentPath.parentPath
        while (t.isJSXElement(rootJSXElement.parentPath)) {
          rootJSXElement = rootJSXElement.parentPath
        }

        // Wrap root JSXElement with React.createElement(). This way we can have an inline
        // scope for internal hooks
        if (!isWrappedWithCreateElement(rootJSXElement)) {
          jsxElementsToWrap.add(rootJSXElement)

          // We escape now, but we should be back again at the second round of traversal
          // after replacement at visitor.JSXElement
          return
        }

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
        // Will ignore block scoped return statements e.g. wrapped by if {}
        if (!isAnyFunctionExpression(path.parentPath.parentPath.node)) return

        const ownBindings = getAllOwnBindings(path.scope)

        Object.keys(ownBindings).forEach(bindingName => {
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
          const wrappedAssignment = generateReplacement(bindingName, binding.path.get('init'))

          binding.path.parentPath.replaceWith(wrappedAssignment)
        })
      },
    },
  }
}
