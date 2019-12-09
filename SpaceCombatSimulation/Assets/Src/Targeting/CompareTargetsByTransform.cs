using Assets.Src.Interfaces;
using System.Collections.Generic;
using UnityEngine;

namespace Assets.Src.Targeting
{
    sealed class CompareTargetsByTransform : IEqualityComparer<ITarget>
    {
        public bool Equals(ITarget x, ITarget y)
        {
            Debug.Log("MyEquals");
            if (x == null)
                return y == null;
            else if (y == null)
                return false;
            else
                return x.Transform == y.Transform;
        }

        public int GetHashCode(ITarget obj)
        {
            return obj.Transform.GetHashCode();
        }
    }
}