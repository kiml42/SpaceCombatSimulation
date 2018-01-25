using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Interfaces
{
    public interface IDestroyer
    {
        void Destroy(GameObject toDestroy, bool useExplosion);
    }
}
