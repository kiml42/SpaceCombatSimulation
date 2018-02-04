using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Interfaces
{
    public interface IExploder
    {
        void SetExplodingObject(Rigidbody explodingRigidbody);
        void ExplodeNow(Vector3? velocityOverride = null);
    }
}
