using Assets.Src.Targeting;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using UnityEngine;

namespace Assets.Src.Interfaces
{
    public interface ITarget
    {
        Transform Transform { get; }
        Rigidbody Rigidbody { get; }
        ShipType Type { get; }
    }
}
