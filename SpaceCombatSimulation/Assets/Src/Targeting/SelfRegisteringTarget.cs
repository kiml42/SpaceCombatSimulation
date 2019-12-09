using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using Assets.Src.Targeting;
using UnityEngine;

public class SelfRegisteringTarget : MonoBehaviour, ITarget
{
    [Tooltip("True of turrets and missiles should try to kill this if it's an enemy.")]
    public bool Shooting = true;
    public bool AtackTarget => Shooting;

    [Tooltip("True if ships should manuvre towards or away from this (or go round and round it if they want to).")]
    public bool Navigation = false;
    public bool NavigationalTarget => Navigation;

    public Transform Transform => this == null ? null : transform;

    private bool _hasLookedForRigidbody = false;
    private Rigidbody _rigidbody;
    public Rigidbody Rigidbody
    {
        get
        {
            if(! _hasLookedForRigidbody && _rigidbody == null)
            {
                _hasLookedForRigidbody = true;
                _rigidbody = GetComponent<Rigidbody>();
            }
            return _rigidbody;
        }
    }

    private TypeKnower typeKnower;

    public ShipType Type
    {
        get
        {
            if (typeKnower == null)
            {
                typeKnower = GetComponent<TypeKnower>();
            }
            if (typeKnower == null)
            {
                Debug.LogWarning($"{Transform} has no type knower - assuming it's a frigate");
                typeKnower = gameObject.AddComponent<TypeKnower>();
                typeKnower.Type = ShipType.Frigate;
            }
            return typeKnower.Type;
        }
    }

    [Tooltip("The team to initially set this target to, if null or empty, the target will need its team set later. This value is for display purposes only in play mode.")]
    public string InitialTeam;

    public string Team { get; private set; }

    // Use this for initialization
    void Start() {        
        if (!string.IsNullOrEmpty(InitialTeam))
        {
            Team = InitialTeam;
            TargetRepository.RegisterTarget(this);
        }
    }

    public void Deactivate()
    {
        TargetRepository.DeregisterTarget(this);
    }

    /// <summary>
    /// Sets the team to the given value and updates all required references.
    /// </summary>
    /// <param name="newTeam"></param>
    public void SetTeam(string newTeam)
    {
        InitialTeam = newTeam;
        if(newTeam == Team)
        {
            //no change required.
            return;
        }

        if (!string.IsNullOrEmpty(Team))
        {
            TargetRepository.DeregisterTarget(this);
        }

        Team = newTeam;

        if (!string.IsNullOrEmpty(newTeam))
        {
            TargetRepository.RegisterTarget(this);
        }
    }
}
