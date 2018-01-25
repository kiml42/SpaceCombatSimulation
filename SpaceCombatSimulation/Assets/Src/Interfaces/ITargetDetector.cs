using Assets.Src.Targeting;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Assets.Src.Interfaces
{
    public interface ITargetDetector
    {
        IEnumerable<PotentialTarget> DetectTargets();
    }
}
