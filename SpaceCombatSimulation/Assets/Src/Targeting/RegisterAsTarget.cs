using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using Assets.Src.Targeting;
using UnityEngine;

public class RegisterAsTarget : MonoBehaviour, ITarget
{
    [Tooltip("Register as a target to be flown towards or shot at.")]
    public bool Shooting = true;

    [Tooltip("Register as a target to be flown towards but not shot at.")]
    public bool Navigation = false;

    public Transform Transform => this == null ? null : transform;

    public Rigidbody Rigidbody { get; private set; }

    private TypeKnower typeKnower;

    public ShipType Type => typeKnower.Type;

    public string Team { get; set; }

    // Use this for initialization
    void Start () {
        Rigidbody = GetComponent<Rigidbody>();
        typeKnower = GetComponent<TypeKnower>();
        if(typeKnower == null)
        {
            Debug.LogWarning($"{Transform} has no type knower - assuming it's a frigate");
            typeKnower = gameObject.AddComponent<TypeKnower>();
            typeKnower.Type = ShipType.Frigate;
        }
        if (string.IsNullOrEmpty(Team))
        {
            Team = Transform.tag;
        }

        if (Navigation)
        {
            TargetRepository.RegisterNavigationTarget(this);
        }
        if (Shooting)
        {
            TargetRepository.RegisterTarget(this);
        }
	}

    public void Deactivate()
    {
        TargetRepository.DeregisterTarget(transform);
    }
}
