using Assets.Src.Interfaces;
using System.Collections.Generic;
using UnityEngine;

namespace Assets.Src.Targeting
{
    /// <summary>
    /// Class for wrapping target rigidbody and transform
    /// </summary>
    public class Target : ITarget
    {
        public Transform Transform { get; private set; }
        public Rigidbody Rigidbody { get; private set; }
        private ShipType? _type;
        public ShipType Type
        {
            get
            {
                if (!_type.HasValue)
                {
                    var typeKnower = Transform.GetComponent<TypeKnower>();
                    if(typeKnower == null)
                    {
                        Debug.LogWarning(Transform + " has no TypeKnower");
                        _type = ShipType.Fighter;
                    } else
                    {
                        _type = typeKnower.Type;
                    }
                }
                return _type.Value;
            }
        }

        public string Team
        {
            get { return Transform.tag; }
            set { Transform.tag = value; }
        }


        public Target(Rigidbody target)
        {
            Rigidbody = target;
            if(target == null)
            {
                Debug.LogWarning("Created target for null rigidbody");
                return;
            }
            Transform = target.transform;
        }

        public Target(Transform target)
        {
            Transform = target;
            if (target == null)
            {
                Debug.LogWarning("Created target for null transform");
                return;
            }
            Rigidbody = target.GetComponent<Rigidbody>();
        }

        public Target(ITarget target)
        {
            Transform = target.Transform;
            Rigidbody = target.Rigidbody;
        }

        public bool Equals(ITarget other)
        {
            Debug.Log("Using my equals");
            return Transform == other.Transform;
        }

        public override string ToString()
        {
            return Transform.name + base.ToString();
        }
    }

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
