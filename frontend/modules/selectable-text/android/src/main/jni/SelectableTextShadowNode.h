#pragma once

#include <react/renderer/components/SelectableTextSpec/EventEmitters.h>
#include <react/renderer/components/SelectableTextSpec/Props.h>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/utils/ContextContainer.h>

namespace facebook::react {

extern const char SelectableTextComponentName[];

class SelectableTextShadowNode final
    : public ConcreteViewShadowNode<
          SelectableTextComponentName,
          DuoSelectableTextProps,
          DuoSelectableTextEventEmitter> {
 public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;

  static ShadowNodeTraits BaseTraits() {
    auto traits = ConcreteViewShadowNode::BaseTraits();
    traits.set(ShadowNodeTraits::Trait::LeafYogaNode);
    traits.set(ShadowNodeTraits::Trait::MeasurableYogaNode);
    return traits;
  }

  void setContextContainer(
      std::shared_ptr<const ContextContainer> contextContainer);

  Size measureContent(
      const LayoutContext& layoutContext,
      const LayoutConstraints& layoutConstraints) const override;

 private:
  std::shared_ptr<const ContextContainer> contextContainer_;
};

} // namespace facebook::react
