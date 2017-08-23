using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.src.interfaces
{
    public interface IExploder
    {
        void SetExplodingObject(Rigidbody explodingRigidbody);
        void ExplodeNow();
    }
}
