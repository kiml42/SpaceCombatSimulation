using Assets.Src.Targeting;
using System.Collections.Generic;

namespace Assets.Src.Interfaces
{
    public interface IKnowsCurrentTarget
    {
        ITarget CurrentTarget { get; }
        IEnumerable<ITarget> FilteredTargets { get; }
    }
}
