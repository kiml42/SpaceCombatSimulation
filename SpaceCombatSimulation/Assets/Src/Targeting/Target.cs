using Assets.Src.Interfaces;
using System;
using UnityEngine;

namespace Assets.Src.Targeting
{
    /// <summary>
    /// Class for wrapping target rigidbody and transform
    /// </summary>
    [Obsolete("Should not be instanciating targets like this")]
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

        public bool NavigationalTarget => throw new NotImplementedException();

        public bool AtackTarget => throw new NotImplementedException();

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
}
